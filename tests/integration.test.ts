/**
 * Integration tests against real @simplewebauthn/server (NO mocks).
 * Uses a software FIDO2 authenticator to produce valid WebAuthn responses.
 */
import { describe, it, expect } from 'vitest';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';
import { verifyRegistration } from '../src/registration-verify.js';
import { verifyTapProof } from '../src/verify.js';
import { createChallenge } from '../src/challenge.js';
import { createConfirmation } from '../src/confirm.js';
import {
  hashAction,
  combineAndHash,
  bufferToBase64url,
  base64urlToBuffer,
  deriveConfirmationCode,
} from '../src/hash.js';
import { HumanKeyError } from '../src/errors.js';
import type { ActionPayload, TapCredential } from '../src/types.js';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3000';
const TEST_AAGUID = '00000000-0000-0000-0000-000000000000';

describe('integration (real @simplewebauthn/server)', () => {
  it('full registration flow succeeds', async () => {
    const authenticator = new SoftAuthenticator();
    const challenge = createChallenge();

    const regResponse = authenticator.register({
      challenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
      aaguid: TEST_AAGUID,
    });

    const result = await verifyRegistration({
      response: regResponse,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    expect(result.verified).toBe(true);
    expect(result.credential.id).toBe(authenticator.getCredentialId());
    expect(result.credential.publicKey.length).toBeGreaterThan(0);
    expect(result.credential.counter).toBe(0);
    expect(result.credential.aaguid).toBe(TEST_AAGUID);
  });

  it('AAGUID allowlist accepts matching authenticator', async () => {
    const authenticator = new SoftAuthenticator();
    const challenge = createChallenge();

    const regResponse = authenticator.register({
      challenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
      aaguid: TEST_AAGUID,
    });

    const result = await verifyRegistration({
      response: regResponse,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      allowedAAGUIDs: [TEST_AAGUID],
    });

    expect(result.verified).toBe(true);
  });

  it('AAGUID allowlist rejects non-matching authenticator', async () => {
    const authenticator = new SoftAuthenticator();
    const challenge = createChallenge();

    const regResponse = authenticator.register({
      challenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
      aaguid: TEST_AAGUID,
    });

    try {
      await verifyRegistration({
        response: regResponse,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        allowedAAGUIDs: ['11111111-1111-1111-1111-111111111111'],
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('AAGUID_NOT_ALLOWED');
    }
  });

  it('full tap flow: register → confirm → authenticate → verify', async () => {
    // 1. Register
    const authenticator = new SoftAuthenticator();
    const regChallenge = createChallenge();

    const regResponse = authenticator.register({
      challenge: regChallenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
    });

    const regResult = await verifyRegistration({
      response: regResponse,
      expectedChallenge: regChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    const credential: TapCredential = regResult.credential;

    // 2. Create action + confirmation
    const action: ActionPayload = { action: 'send-payment', data: { to: 'bob', amount: 100 } };
    const confirmation = await createConfirmation(action);

    // 3. Simulate requestTap internals (challenge binding)
    const serverChallenge = createChallenge();
    const actionHashBuffer = await hashAction(action);
    const actionHash = bufferToBase64url(actionHashBuffer);
    const code = deriveConfirmationCode(actionHashBuffer);
    const confirmationInput = `${code}:${code}`;
    const confirmationHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(confirmationInput),
    );
    const confirmationHash = bufferToBase64url(confirmationHashBuffer);

    const challengeBuffer = base64urlToBuffer(serverChallenge);
    const finalChallenge = await combineAndHash(
      challengeBuffer,
      actionHashBuffer,
      confirmationHashBuffer,
    );
    const finalChallengeB64 = bufferToBase64url(finalChallenge);

    // 4. Authenticate with the bound challenge
    const authResponse = authenticator.authenticate({
      challenge: finalChallengeB64,
      rpId: RP_ID,
      origin: ORIGIN,
      credentialId: credential.id,
      counter: 1,
    });

    // 5. Verify the tap proof
    const result = await verifyTapProof({
      proof: {
        response: authResponse,
        action,
        actionHash,
        confirmationHash,
        userInput: code,
      },
      credential,
      expectedChallenge: serverChallenge,
      expectedAction: action,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    expect(result.verified).toBe(true);
    expect(result.confirmationValid).toBe(true);
    expect(result.newCounter).toBe(1);
  });

  it('wrong confirmation code throws CONFIRMATION_MISMATCH', async () => {
    // Register
    const authenticator = new SoftAuthenticator();
    const regChallenge = createChallenge();
    const regResponse = authenticator.register({
      challenge: regChallenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
    });
    const { credential } = await verifyRegistration({
      response: regResponse,
      expectedChallenge: regChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    const action: ActionPayload = { action: 'test', data: {} };
    const serverChallenge = createChallenge();
    const actionHashBuffer = await hashAction(action);
    const actionHash = bufferToBase64url(actionHashBuffer);
    const correctCode = deriveConfirmationCode(actionHashBuffer);

    // Use wrong code for the confirmation hash
    const wrongCode = 'ZZZZ';
    const confirmationInput = `${correctCode}:${wrongCode}`;
    const confirmationHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(confirmationInput),
    );
    const confirmationHash = bufferToBase64url(confirmationHashBuffer);

    const challengeBuffer = base64urlToBuffer(serverChallenge);
    const finalChallenge = await combineAndHash(
      challengeBuffer,
      actionHashBuffer,
      confirmationHashBuffer,
    );

    const authResponse = authenticator.authenticate({
      challenge: bufferToBase64url(finalChallenge),
      rpId: RP_ID,
      origin: ORIGIN,
      credentialId: credential.id,
      counter: 1,
    });

    try {
      await verifyTapProof({
        proof: {
          response: authResponse,
          action,
          actionHash,
          confirmationHash,
          userInput: wrongCode,
        },
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: action,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('CONFIRMATION_MISMATCH');
    }
  });

  it('tampered action throws ACTION_HASH_MISMATCH', async () => {
    const authenticator = new SoftAuthenticator();
    const regChallenge = createChallenge();
    const regResponse = authenticator.register({
      challenge: regChallenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
    });
    const { credential } = await verifyRegistration({
      response: regResponse,
      expectedChallenge: regChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    const clientAction: ActionPayload = { action: 'send', data: { amount: 10 } };
    const serverAction: ActionPayload = { action: 'send', data: { amount: 10000 } };

    const serverChallenge = createChallenge();
    const actionHashBuffer = await hashAction(clientAction);
    const actionHash = bufferToBase64url(actionHashBuffer);
    const code = deriveConfirmationCode(actionHashBuffer);
    const confirmationInput = `${code}:${code}`;
    const confirmationHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(confirmationInput),
    );
    const confirmationHash = bufferToBase64url(confirmationHashBuffer);

    const challengeBuffer = base64urlToBuffer(serverChallenge);
    const finalChallenge = await combineAndHash(
      challengeBuffer,
      actionHashBuffer,
      confirmationHashBuffer,
    );

    const authResponse = authenticator.authenticate({
      challenge: bufferToBase64url(finalChallenge),
      rpId: RP_ID,
      origin: ORIGIN,
      credentialId: credential.id,
      counter: 1,
    });

    try {
      await verifyTapProof({
        proof: {
          response: authResponse,
          action: clientAction,
          actionHash,
          confirmationHash,
          userInput: code,
        },
        credential,
        expectedChallenge: serverChallenge,
        expectedAction: serverAction, // Different from what client signed
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('ACTION_HASH_MISMATCH');
    }
  });

  it('counter replay throws COUNTER_REPLAY', async () => {
    const authenticator = new SoftAuthenticator();
    const regChallenge = createChallenge();
    const regResponse = authenticator.register({
      challenge: regChallenge,
      rpId: RP_ID,
      rpName: 'Test',
      userId: bufferToBase64url(crypto.getRandomValues(new Uint8Array(16)).buffer),
      userName: 'test-user',
      origin: ORIGIN,
    });
    const { credential } = await verifyRegistration({
      response: regResponse,
      expectedChallenge: regChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    // First successful tap (counter goes from 0 to 1)
    const action: ActionPayload = { action: 'test', data: {} };
    const challenge1 = createChallenge();
    const actionHashBuffer = await hashAction(action);
    const actionHash = bufferToBase64url(actionHashBuffer);
    const code = deriveConfirmationCode(actionHashBuffer);
    const confirmationInput = `${code}:${code}`;
    const confirmationHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(confirmationInput),
    );
    const confirmationHash = bufferToBase64url(confirmationHashBuffer);

    const final1 = await combineAndHash(
      base64urlToBuffer(challenge1),
      actionHashBuffer,
      confirmationHashBuffer,
    );

    const auth1 = authenticator.authenticate({
      challenge: bufferToBase64url(final1),
      rpId: RP_ID,
      origin: ORIGIN,
      credentialId: credential.id,
      counter: 1,
    });

    const result1 = await verifyTapProof({
      proof: { response: auth1, action, actionHash, confirmationHash, userInput: code },
      credential,
      expectedChallenge: challenge1,
      expectedAction: action,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    // Update credential counter
    credential.counter = result1.newCounter;

    // Second tap with SAME counter (replay)
    const challenge2 = createChallenge();
    const final2 = await combineAndHash(
      base64urlToBuffer(challenge2),
      actionHashBuffer,
      confirmationHashBuffer,
    );

    const auth2 = authenticator.authenticate({
      challenge: bufferToBase64url(final2),
      rpId: RP_ID,
      origin: ORIGIN,
      credentialId: credential.id,
      counter: 1, // Same counter — replay!
    });

    try {
      await verifyTapProof({
        proof: { response: auth2, action, actionHash, confirmationHash, userInput: code },
        credential,
        expectedChallenge: challenge2,
        expectedAction: action,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('COUNTER_REPLAY');
    }
  });
});
