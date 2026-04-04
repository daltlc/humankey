import { describe, it, expect, vi } from 'vitest';
import { verifyTapProof } from '../src/verify.js';
import { HumanKeyError } from '../src/errors.js';
import { hashAction, bufferToBase64url, combineAndHash, base64urlToBuffer, deriveConfirmationCode } from '../src/hash.js';
import type { ActionPayload, TapProof, TapCredential } from '../src/types.js';

// Mock @simplewebauthn/server
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyAuthenticationResponse } from '@simplewebauthn/server';
const mockVerify = vi.mocked(verifyAuthenticationResponse);

// Test fixtures
const action: ActionPayload = {
  action: 'send-message',
  data: { to: 'bob', body: 'hello' },
};

const credential: TapCredential = {
  id: 'test-credential-id',
  publicKey: new Uint8Array([1, 2, 3, 4]),
  counter: 5,
  deviceType: 'singleDevice',
  backedUp: false,
  aaguid: 'test-aaguid',
};

async function buildValidProof(
  serverChallenge: string,
  testAction: ActionPayload,
): Promise<TapProof> {
  const actionHashBuffer = await hashAction(testAction);
  const actionHash = bufferToBase64url(actionHashBuffer);
  const code = deriveConfirmationCode(actionHashBuffer);
  const confirmationInput = `${code}:${code}`;
  const confirmationHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(confirmationInput),
  );
  const confirmationHash = bufferToBase64url(confirmationHashBuffer);

  return {
    response: {} as TapProof['response'], // Mock — actual verification is mocked
    action: testAction,
    actionHash,
    confirmationHash,
    userInput: code,
  };
}

describe('verifyTapProof', () => {
  const serverChallenge = bufferToBase64url(new Uint8Array(32).buffer);

  it('returns verified=true when everything checks out', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        userVerified: true,
        credentialID: 'test-credential-id',
        origin: 'https://example.com',
        rpID: 'example.com',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        authenticatorExtensionResults: undefined,
      },
    });

    const result = await verifyTapProof({
      proof,
      credential,
      expectedChallenge: serverChallenge,
      expectedAction: action,
      expectedOrigin: 'https://example.com',
      expectedRPID: 'example.com',
    });

    expect(result.verified).toBe(true);
    expect(result.userVerified).toBe(true);
    expect(result.confirmationValid).toBe(true);
    expect(result.newCounter).toBe(6);
  });

  it('throws ACTION_HASH_MISMATCH when action was tampered', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    const differentAction: ActionPayload = {
      action: 'send-message',
      data: { to: 'eve', body: 'steal money' },
    };

    await expect(
      verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: differentAction,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
      }),
    ).rejects.toThrow(HumanKeyError);

    try {
      await verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: differentAction,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
      });
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('ACTION_HASH_MISMATCH');
    }
  });

  it('throws USER_VERIFICATION_MISSING when UV not performed', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        userVerified: false,
        credentialID: 'test-credential-id',
        origin: 'https://example.com',
        rpID: 'example.com',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        authenticatorExtensionResults: undefined,
      },
    });

    await expect(
      verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: action,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
        requireUserVerification: true,
      }),
    ).rejects.toThrow(HumanKeyError);
  });

  it('throws COUNTER_REPLAY when counter does not increase', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 5, // Same as stored counter
        userVerified: true,
        credentialID: 'test-credential-id',
        origin: 'https://example.com',
        rpID: 'example.com',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        authenticatorExtensionResults: undefined,
      },
    });

    await expect(
      verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: action,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
      }),
    ).rejects.toThrow(HumanKeyError);
  });

  it('throws VERIFICATION_FAILED when WebAuthn verification fails', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    mockVerify.mockRejectedValueOnce(new Error('Invalid signature'));

    await expect(
      verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: action,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
      }),
    ).rejects.toThrow(HumanKeyError);
  });

  it('throws CONFIRMATION_MISMATCH when user typed wrong code (default)', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    proof.userInput = 'ZZZZ';

    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        userVerified: true,
        credentialID: 'test-credential-id',
        origin: 'https://example.com',
        rpID: 'example.com',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        authenticatorExtensionResults: undefined,
      },
    });

    await expect(
      verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: action,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
      }),
    ).rejects.toThrow(HumanKeyError);

    // Verify the error code
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        userVerified: true,
        credentialID: 'test-credential-id',
        origin: 'https://example.com',
        rpID: 'example.com',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        authenticatorExtensionResults: undefined,
      },
    });

    try {
      await verifyTapProof({
        proof,
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: action,
        expectedOrigin: 'https://example.com',
        expectedRPID: 'example.com',
      });
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('CONFIRMATION_MISMATCH');
    }
  });

  it('returns confirmationValid=false when requireConfirmation is false', async () => {
    const proof = await buildValidProof(serverChallenge, action);
    proof.userInput = 'ZZZZ';

    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
        userVerified: true,
        credentialID: 'test-credential-id',
        origin: 'https://example.com',
        rpID: 'example.com',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        authenticatorExtensionResults: undefined,
      },
    });

    const result = await verifyTapProof({
      proof,
      credential,
      expectedChallenge: serverChallenge,
      expectedAction: action,
      expectedOrigin: 'https://example.com',
      expectedRPID: 'example.com',
      requireConfirmation: false,
    });

    expect(result.verified).toBe(true);
    expect(result.confirmationValid).toBe(false);
  });
});
