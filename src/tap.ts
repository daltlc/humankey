import { startAuthentication } from '@simplewebauthn/browser';
import type { TapRequest, TapProof } from './types.js';
import { validateConfirmation } from './confirm.js';
import {
  hashAction,
  combineAndHash,
  bufferToBase64url,
  base64urlToBuffer,
} from './hash.js';
import { HumanKeyError } from './errors.js';

/**
 * Request a hardware key tap to approve an action.
 * Requires a valid confirmation (user must have typed the correct code).
 *
 * Flow:
 * 1. Validates the confirmation code
 * 2. Hashes the action + confirmation into the WebAuthn challenge
 * 3. Prompts the user to tap their hardware key
 * 4. Returns a TapProof containing the signed assertion
 */
export async function requestTap(request: TapRequest): Promise<TapProof> {
  const {
    challenge,
    action,
    confirmation,
    userInput,
    allowCredentials,
    rpID,
    userVerification = 'required',
    timeout = 60000,
  } = request;

  // Validate confirmation code before proceeding
  validateConfirmation(confirmation, userInput);

  // Re-derive action hash and create confirmation hash
  const actionHashBuffer = await hashAction(action);
  const confirmationInput = `${confirmation.code}:${userInput.toUpperCase().trim()}`;
  const confirmationHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(confirmationInput),
  );

  // Combine server challenge + action hash + confirmation hash into final challenge
  const challengeBuffer = base64urlToBuffer(challenge);
  const finalChallenge = await combineAndHash(
    challengeBuffer,
    actionHashBuffer,
    confirmationHashBuffer,
  );

  const actionHash = bufferToBase64url(actionHashBuffer);
  const confirmationHash = bufferToBase64url(confirmationHashBuffer);

  try {
    const response = await startAuthentication({
      optionsJSON: {
        challenge: bufferToBase64url(finalChallenge),
        rpId: rpID,
        allowCredentials: allowCredentials.map((cred) => ({
          id: cred.id,
          type: 'public-key' as const,
          transports: cred.transports,
        })),
        userVerification,
        timeout,
      },
    });

    return {
      response,
      action,
      actionHash,
      confirmationHash,
      userInput: userInput.toUpperCase().trim(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'NotAllowedError'
    ) {
      throw new HumanKeyError(
        'User cancelled the hardware key tap',
        'USER_CANCELLED',
        error,
      );
    }
    throw error;
  }
}
