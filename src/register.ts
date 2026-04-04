import { startRegistration } from '@simplewebauthn/browser';
import type { RegisterKeyRequest, RegistrationResult } from './types.js';
import { bufferToBase64url } from './hash.js';
import { HumanKeyError } from './errors.js';

/**
 * Register a new hardware key for per-action verification.
 * Defaults to cross-platform authenticators (YubiKey, not Touch ID)
 * and direct attestation (verifies real hardware).
 */
export async function registerKey(
  request: RegisterKeyRequest,
): Promise<RegistrationResult> {
  const {
    challenge,
    rpID,
    rpName,
    userName,
    userDisplayName = userName,
    excludeCredentials = [],
    attestation = 'direct',
    userVerification = 'required',
    timeout = 60000,
  } = request;

  // Generate a user ID from the username
  const userIdBytes = new TextEncoder().encode(userName);
  const userIdHash = await crypto.subtle.digest('SHA-256', userIdBytes);
  const userId = bufferToBase64url(userIdHash);

  try {
    const response = await startRegistration({
      optionsJSON: {
        rp: { name: rpName, id: rpID },
        user: {
          id: userId,
          name: userName,
          displayName: userDisplayName,
        },
        challenge,
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
        ],
        timeout,
        attestation,
        excludeCredentials: excludeCredentials.map((cred) => ({
          id: cred.id,
          type: 'public-key' as const,
          transports: cred.transports,
        })),
        authenticatorSelection: {
          authenticatorAttachment: 'cross-platform',
          residentKey: 'preferred',
          userVerification,
        },
      },
    });

    return {
      credentialId: response.id,
      response,
      transports: response.response.transports,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new HumanKeyError(
        'User cancelled hardware key registration',
        'USER_CANCELLED',
        error,
      );
    }
    throw new HumanKeyError(
      `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'REGISTRATION_FAILED',
      error,
    );
  }
}
