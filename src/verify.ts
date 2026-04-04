import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { VerifyTapProofRequest, VerifyResult } from './types.js';
import {
  hashAction,
  combineAndHash,
  bufferToBase64url,
  base64urlToBuffer,
  deriveConfirmationCode,
} from './hash.js';
import { HumanKeyError } from './errors.js';

/**
 * Verify a TapProof on the server.
 * Re-derives all hashes from the server's copy of the action to ensure integrity.
 *
 * Checks:
 * 1. Action hash matches (client didn't tamper with the action)
 * 2. Confirmation code is valid for this action
 * 3. WebAuthn signature is valid
 * 4. User verification flag is set (independent of browser claim)
 * 5. Signature counter increased (replay protection)
 */
export async function verifyTapProof(
  request: VerifyTapProofRequest,
): Promise<VerifyResult> {
  const {
    proof,
    credential,
    expectedChallenge,
    expectedAction,
    expectedOrigin,
    expectedRPID,
    requireUserVerification = true,
  } = request;

  // Re-derive action hash from the server's copy of the action
  const actionHashBuffer = await hashAction(expectedAction);
  const expectedActionHash = bufferToBase64url(actionHashBuffer);

  // Verify action hash matches what the client claims
  if (proof.actionHash !== expectedActionHash) {
    throw new HumanKeyError(
      'Action hash mismatch — the client may have signed a different action than expected',
      'ACTION_HASH_MISMATCH',
    );
  }

  // Re-derive the expected confirmation code from the action hash
  const expectedCode = deriveConfirmationCode(actionHashBuffer);
  const confirmationValid =
    proof.userInput.toUpperCase().trim() === expectedCode.toUpperCase();

  // Re-derive confirmation hash
  const confirmationInput = `${expectedCode}:${proof.userInput.toUpperCase().trim()}`;
  const confirmationHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(confirmationInput),
  );

  // Reconstruct the expected final challenge
  const challengeBuffer = base64urlToBuffer(expectedChallenge);
  const expectedFinalChallenge = await combineAndHash(
    challengeBuffer,
    actionHashBuffer,
    confirmationHashBuffer,
  );
  const expectedFinalChallengeB64 = bufferToBase64url(expectedFinalChallenge);

  // Verify the WebAuthn assertion
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: proof.response,
      expectedChallenge: expectedFinalChallengeB64,
      expectedOrigin,
      expectedRPID,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey as Uint8Array<ArrayBuffer>,
        counter: credential.counter,
        transports: credential.transports,
      },
      requireUserVerification,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Detect counter replay from @simplewebauthn/server's own check
    if (message.includes('counter') && message.includes('lower than expected')) {
      throw new HumanKeyError(
        `Signature counter replay detected — ${message}`,
        'COUNTER_REPLAY',
        error,
      );
    }
    throw new HumanKeyError(
      `WebAuthn verification failed: ${message}`,
      'VERIFICATION_FAILED',
      error,
    );
  }

  if (!verification.verified) {
    throw new HumanKeyError(
      'WebAuthn signature verification failed',
      'VERIFICATION_FAILED',
    );
  }

  const { authenticationInfo } = verification;

  // Independent UV flag check (Safari clamshell mode workaround)
  if (requireUserVerification && !authenticationInfo.userVerified) {
    throw new HumanKeyError(
      'User verification was required but not performed — the authenticator did not verify the user (possible Safari clamshell mode issue)',
      'USER_VERIFICATION_MISSING',
    );
  }

  // Confirmation code enforcement (after signature check to avoid leaking confirmation status)
  const requireConfirmation = request.requireConfirmation ?? true;
  if (requireConfirmation && !confirmationValid) {
    throw new HumanKeyError(
      'Confirmation code mismatch',
      'CONFIRMATION_MISMATCH',
    );
  }

  // Counter replay protection
  if (authenticationInfo.newCounter <= credential.counter && credential.counter !== 0) {
    throw new HumanKeyError(
      `Signature counter did not increase (got ${authenticationInfo.newCounter}, expected > ${credential.counter}) — possible cloned key`,
      'COUNTER_REPLAY',
    );
  }

  return {
    verified: true,
    userVerified: authenticationInfo.userVerified,
    confirmationValid,
    newCounter: authenticationInfo.newCounter,
  };
}

export { HumanKeyError } from './errors.js';
export { createChallenge } from './challenge.js';
export { verifyRegistration } from './registration-verify.js';
export type { VerifyRegistrationRequest, VerifyRegistrationResult } from './registration-verify.js';
export type { HumanKeyErrorCode } from './errors.js';
export type {
  VerifyTapProofRequest,
  VerifyResult,
  TapProof,
  TapCredential,
  ActionPayload,
  RegistrationResponseJSON,
} from './types.js';
