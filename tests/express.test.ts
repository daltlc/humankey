import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createHumanKeyRouter,
  MemoryChallengeStore,
} from '../src/express.js';
import type { TapCredential } from '../src/types.js';
import { hashAction, bufferToBase64url, combineAndHash, base64urlToBuffer, deriveConfirmationCode } from '../src/hash.js';

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

function createTestApp(overrides?: Partial<Parameters<typeof createHumanKeyRouter>[0]>) {
  const app = express();
  app.use(express.json());

  const credentials = new Map<string, TapCredential>();
  const onRegister = vi.fn(async (cred: TapCredential) => {
    credentials.set(cred.id, cred);
  });
  const onVerify = vi.fn();

  const router = createHumanKeyRouter({
    rpID: 'localhost',
    rpName: 'Test',
    origin: 'http://localhost:3000',
    requireUserVerification: false,
    getCredential: async (id) => credentials.get(id) ?? null,
    onRegister,
    onVerify,
    ...overrides,
  });

  app.use('/api', router);
  return { app, credentials, onRegister, onVerify };
}

describe('createHumanKeyRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /challenge', () => {
    it('returns a challengeId and challenge', async () => {
      const { app } = createTestApp();
      const res = await request(app).post('/api/challenge');

      expect(res.status).toBe(200);
      expect(res.body.challengeId).toBeDefined();
      expect(res.body.challenge).toBeDefined();
      expect(res.body.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('POST /register', () => {
    it('calls onRegister on successful registration', async () => {
      const { app, onRegister } = createTestApp();

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

      // First get a challenge
      const challengeRes = await request(app).post('/api/challenge');
      const { challengeId } = challengeRes.body;

      const res = await request(app)
        .post('/api/register')
        .send({ response: {}, challengeId });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.credentialId).toBe('cred-new');
      expect(onRegister).toHaveBeenCalledOnce();
    });

    it('returns 400 for invalid challengeId', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/register')
        .send({ response: {}, challengeId: 'nonexistent' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Challenge');
    });
  });

  describe('POST /verify', () => {
    it('returns verification result on success', async () => {
      const { app, credentials } = createTestApp();
      credentials.set('cred-123', testCredential);

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

      const challengeRes = await request(app).post('/api/challenge');
      const { challengeId, challenge } = challengeRes.body;

      // Build a valid proof with matching action hashes
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

      const res = await request(app)
        .post('/api/verify')
        .send({
          proof: {
            response: { id: 'cred-123' },
            action,
            actionHash,
            confirmationHash,
            userInput: code,
          },
          challengeId,
          action,
        });

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
    });

    it('returns 400 for unknown credential', async () => {
      const { app } = createTestApp();

      const challengeRes = await request(app).post('/api/challenge');
      const { challengeId } = challengeRes.body;

      const res = await request(app)
        .post('/api/verify')
        .send({
          proof: { response: { id: 'nonexistent' } },
          challengeId,
          action: { action: 'test', data: {} },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Credential');
    });
  });
});

describe('MemoryChallengeStore', () => {
  it('enforces single-use (second get returns null)', async () => {
    const store = new MemoryChallengeStore();
    await store.set('id1', 'challenge1', 60000);

    const first = await store.get('id1');
    const second = await store.get('id1');

    expect(first).toBe('challenge1');
    expect(second).toBeNull();
  });

  it('enforces TTL (expired challenge returns null)', async () => {
    const store = new MemoryChallengeStore();
    await store.set('id1', 'challenge1', 1); // 1ms TTL

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));

    const result = await store.get('id1');
    expect(result).toBeNull();
  });

  it('returns null for nonexistent challenge', async () => {
    const store = new MemoryChallengeStore();
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });
});
