import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveConfig,
  handleChallenge,
  handleRegister,
  handleVerify,
  MemoryChallengeStore,
} from '../src/adapter-core.js';
import type { ResolvedConfig } from '../src/adapter-core.js';
import type { TapCredential } from '../src/types.js';
import { hashAction, bufferToBase64url, deriveConfirmationCode } from '../src/hash.js';

// Mock the server-side verification functions
vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
const mockRegVerify = vi.mocked(verifyRegistrationResponse);
const mockAuthVerify = vi.mocked(verifyAuthenticationResponse);

const testCredential: TapCredential = {
  id: 'cred-123',
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  deviceType: 'singleDevice',
  backedUp: false,
  aaguid: 'test-aaguid',
};

function createTestConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  const credentials = new Map<string, TapCredential>();
  credentials.set('cred-123', testCredential);

  return resolveConfig({
    rpID: 'localhost',
    rpName: 'Test',
    origin: 'http://localhost:3000',
    requireUserVerification: false,
    getCredential: async (id) => credentials.get(id) ?? null,
    onRegister: vi.fn(),
    onVerify: vi.fn(),
    ...overrides,
  });
}

describe('adapter-core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveConfig', () => {
    it('applies defaults', () => {
      const config = resolveConfig({
        rpID: 'example.com',
        rpName: 'Example',
        origin: 'https://example.com',
        getCredential: async () => null,
        onRegister: async () => {},
      });

      expect(config.challengeTTL).toBe(60_000);
      expect(config.challengeStore).toBeInstanceOf(MemoryChallengeStore);
      expect(config.requireUserVerification).toBe(true);
    });

    it('preserves provided values', () => {
      const store = new MemoryChallengeStore();
      const config = resolveConfig({
        rpID: 'example.com',
        rpName: 'Example',
        origin: 'https://example.com',
        challengeTTL: 30_000,
        challengeStore: store,
        requireUserVerification: false,
        getCredential: async () => null,
        onRegister: async () => {},
      });

      expect(config.challengeTTL).toBe(30_000);
      expect(config.challengeStore).toBe(store);
      expect(config.requireUserVerification).toBe(false);
    });
  });

  describe('handleChallenge', () => {
    it('returns 200 with challengeId and challenge', async () => {
      const config = createTestConfig();
      const result = await handleChallenge(config);

      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('challengeId');
      expect(result.body).toHaveProperty('challenge');
      expect((result.body as { challenge: string }).challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('stores the challenge in the challenge store', async () => {
      const store = new MemoryChallengeStore();
      const config = createTestConfig({ challengeStore: store });

      const result = await handleChallenge(config);
      const { challengeId, challenge } = result.body as { challengeId: string; challenge: string };

      const retrieved = await store.get(challengeId);
      expect(retrieved).toBe(challenge);
    });
  });

  describe('handleRegister', () => {
    it('returns 400 for expired/missing challenge', async () => {
      const config = createTestConfig();
      const result = await handleRegister(config, {
        response: {},
        challengeId: 'nonexistent',
      });

      expect(result.status).toBe(400);
      expect(result.body).toHaveProperty('error');
      expect((result.body as { error: string }).error).toContain('Challenge');
    });

    it('returns 200 and calls onRegister on success', async () => {
      const onRegister = vi.fn();
      const config = createTestConfig({ onRegister });

      mockRegVerify.mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          fmt: 'none',
          aaguid: 'test-aaguid',
          credential: {
            id: 'cred-new',
            publicKey: new Uint8Array([5, 6, 7]),
            counter: 0,
            transports: ['usb'],
          },
          credentialType: 'public-key',
          attestationObject: new Uint8Array(),
          userVerified: false,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          origin: 'http://localhost:3000',
          rpID: 'localhost',
        },
      } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

      // Get a challenge first
      const challengeResult = await handleChallenge(config);
      const { challengeId } = challengeResult.body as { challengeId: string };

      const result = await handleRegister(config, {
        response: {},
        challengeId,
      });

      expect(result.status).toBe(200);
      expect((result.body as { ok: boolean }).ok).toBe(true);
      expect((result.body as { credentialId: string }).credentialId).toBe('cred-new');
      expect(onRegister).toHaveBeenCalledOnce();
    });
  });

  describe('handleVerify', () => {
    it('returns 400 for expired/missing challenge', async () => {
      const config = createTestConfig();
      const result = await handleVerify(config, {
        proof: { response: { id: 'cred-123' } } as never,
        challengeId: 'nonexistent',
        action: { action: 'test', data: {} },
      });

      expect(result.status).toBe(400);
      expect((result.body as { error: string }).error).toContain('Challenge');
    });

    it('returns 400 for unknown credential', async () => {
      const config = createTestConfig();

      const challengeResult = await handleChallenge(config);
      const { challengeId } = challengeResult.body as { challengeId: string };

      const result = await handleVerify(config, {
        proof: { response: { id: 'unknown-cred' } } as never,
        challengeId,
        action: { action: 'test', data: {} },
      });

      expect(result.status).toBe(400);
      expect((result.body as { error: string }).error).toContain('Credential');
    });

    it('returns 200 with verification result on success', async () => {
      const onVerify = vi.fn();
      const config = createTestConfig({ onVerify });

      mockAuthVerify.mockResolvedValueOnce({
        verified: true,
        authenticationInfo: {
          newCounter: 1,
          userVerified: false,
          credentialID: 'cred-123',
          origin: 'http://localhost:3000',
          rpID: 'localhost',
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          authenticatorExtensionResults: undefined,
        },
      });

      const challengeResult = await handleChallenge(config);
      const { challengeId } = challengeResult.body as { challengeId: string };

      const action = { action: 'test', data: {} };
      const actionHashBuffer = await hashAction(action);
      const actionHash = bufferToBase64url(actionHashBuffer);
      const code = deriveConfirmationCode(actionHashBuffer);
      const confirmationInput = `${code}:${code}`;
      const confirmationHashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(confirmationInput),
      );
      const confirmationHash = bufferToBase64url(confirmationHashBuffer);

      const result = await handleVerify(config, {
        proof: {
          response: { id: 'cred-123' },
          action,
          actionHash,
          confirmationHash,
          userInput: code,
        } as never,
        challengeId,
        action,
      });

      expect(result.status).toBe(200);
      expect((result.body as { verified: boolean }).verified).toBe(true);
      expect((result.body as { confirmationValid: boolean }).confirmationValid).toBe(true);
      expect(onVerify).toHaveBeenCalledOnce();
    });
  });
});
