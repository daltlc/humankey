import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { TapCredential } from './types.js';
import { HumanKeyError } from './errors.js';

/** Input for verifyRegistration() */
export interface VerifyRegistrationRequest {
  /** The registration response from the client */
  response: RegistrationResponseJSON;
  /** The challenge you generated server-side (base64url) */
  expectedChallenge: string;
  /** Expected origin(s), e.g. "https://example.com" */
  expectedOrigin: string | string[];
  /** Expected relying party ID */
  expectedRPID?: string | string[];
  /** Require user verification (default: true) */
  requireUserVerification?: boolean;
  /** Restrict registration to specific authenticator models by AAGUID.
   *  When set, only authenticators with a matching AAGUID are accepted. */
  allowedAAGUIDs?: string[];
}

/** Result of verifyRegistration() */
export interface VerifyRegistrationResult {
  /** The verified credential — store this server-side */
  credential: TapCredential;
  /** Whether the registration was verified */
  verified: boolean;
}

/**
 * Verify a registration response on the server and extract the credential.
 * Wraps @simplewebauthn/server's verifyRegistrationResponse and returns
 * a TapCredential ready for storage.
 */
export async function verifyRegistration(
  request: VerifyRegistrationRequest,
): Promise<VerifyRegistrationResult> {
  const {
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    requireUserVerification = true,
    allowedAAGUIDs,
  } = request;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification,
    });
  } catch (error) {
    throw new HumanKeyError(
      `Registration verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'REGISTRATION_FAILED',
      error,
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new HumanKeyError(
      'Registration verification failed',
      'REGISTRATION_FAILED',
    );
  }

  const { registrationInfo } = verification;

  if (allowedAAGUIDs && allowedAAGUIDs.length > 0) {
    if (!allowedAAGUIDs.includes(registrationInfo.aaguid)) {
      throw new HumanKeyError(
        `Authenticator model (AAGUID ${registrationInfo.aaguid}) is not in the allowed list`,
        'AAGUID_NOT_ALLOWED',
      );
    }
  }

  const credential: TapCredential = {
    id: registrationInfo.credential.id,
    publicKey: registrationInfo.credential.publicKey as Uint8Array<ArrayBuffer>,
    counter: registrationInfo.credential.counter,
    transports: registrationInfo.credential.transports as AuthenticatorTransportFuture[] | undefined,
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
    aaguid: registrationInfo.aaguid,
  };

  return { credential, verified: true };
}
