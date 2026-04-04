import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
  CredentialDeviceType,
} from '@simplewebauthn/server';

/** The action the user is approving */
export interface ActionPayload {
  /** Unique action type identifier, e.g. "send-message", "approve-transfer" */
  action: string;
  /** Arbitrary data that gets hashed into the challenge. Supports nested objects and arrays. */
  data: Record<string, unknown>;
}

/** Output of createConfirmation() — contains the code the user must type */
export interface Confirmation {
  /** 4-character alphanumeric code derived from the action hash */
  code: string;
  /** The SHA-256 hash of the canonical action JSON (base64url) */
  actionHash: string;
}

/** Input for requestTap() */
export interface TapRequest {
  /** Server-generated challenge (base64url) */
  challenge: string;
  /** The action being approved */
  action: ActionPayload;
  /** Confirmation from createConfirmation() */
  confirmation: Confirmation;
  /** What the user actually typed as their confirmation code */
  userInput: string;
  /** Credential IDs the user can authenticate with */
  allowCredentials: Array<{
    id: string;
    transports?: AuthenticatorTransportFuture[];
  }>;
  /** Relying party ID, e.g. "example.com" */
  rpID: string;
  /** User verification requirement (default: 'required') */
  userVerification?: UserVerificationRequirement;
  /** Timeout in ms (default: 60000) */
  timeout?: number;
}

/** The signed proof returned by requestTap() — send this to your server */
export interface TapProof {
  /** The raw WebAuthn authentication response */
  response: AuthenticationResponseJSON;
  /** The action that was approved */
  action: ActionPayload;
  /** The action hash that was signed (base64url) */
  actionHash: string;
  /** The confirmation hash that was signed (base64url) */
  confirmationHash: string;
  /** The user's confirmation input */
  userInput: string;
}

/** Input for registerKey() */
export interface RegisterKeyRequest {
  /** Server-generated challenge (base64url) */
  challenge: string;
  /** Relying party ID */
  rpID: string;
  /** Relying party display name */
  rpName: string;
  /** Username for this credential */
  userName: string;
  /** Display name (defaults to userName) */
  userDisplayName?: string;
  /** Credential IDs to exclude (already registered) */
  excludeCredentials?: Array<{
    id: string;
    transports?: AuthenticatorTransportFuture[];
  }>;
  /** Attestation type (default: 'direct' — verifies real hardware key) */
  attestation?: AttestationConveyancePreference;
  /** User verification requirement (default: 'required') */
  userVerification?: UserVerificationRequirement;
  /** Timeout in ms (default: 60000) */
  timeout?: number;
}

/** A registered credential — store this server-side */
export interface TapCredential {
  /** Base64url credential ID */
  id: string;
  /** The credential public key bytes */
  publicKey: Uint8Array;
  /** Signature counter for replay detection */
  counter: number;
  /** Transports the authenticator supports */
  transports?: AuthenticatorTransportFuture[];
  /** Single-device or multi-device credential */
  deviceType: CredentialDeviceType;
  /** Whether the credential is backed up */
  backedUp: boolean;
  /** Authenticator AAGUID — identifies the make/model of the hardware key */
  aaguid: string;
}

/** Result of registerKey() — send the response to your server for verification */
export interface RegistrationResult {
  /** Base64url credential ID */
  credentialId: string;
  /** The raw registration response — send to your server for verifyRegistration() */
  response: RegistrationResponseJSON;
  /** Transports the authenticator supports */
  transports?: AuthenticatorTransportFuture[];
}

/** Input for verifyTapProof() */
export interface VerifyTapProofRequest {
  /** The TapProof from the client */
  proof: TapProof;
  /** The stored credential for this user */
  credential: TapCredential;
  /** The challenge you generated server-side (base64url) */
  expectedChallenge: string;
  /** Your server's copy of the action (used to re-derive hashes) */
  expectedAction: ActionPayload;
  /** Expected origin(s), e.g. "https://example.com" */
  expectedOrigin: string | string[];
  /** Expected relying party ID */
  expectedRPID: string;
  /** Require user verification (default: true) */
  requireUserVerification?: boolean;
  /** When true (default), throw CONFIRMATION_MISMATCH if the user typed the wrong code.
   *  Set to false to handle confirmation validation manually via result.confirmationValid. */
  requireConfirmation?: boolean;
}

/** Result of verifyTapProof() */
export interface VerifyResult {
  /** Overall verification passed */
  verified: boolean;
  /** User verification (biometric/PIN) was performed */
  userVerified: boolean;
  /** User typed the correct confirmation code for this action */
  confirmationValid: boolean;
  /** Updated signature counter — store this */
  newCounter: number;
}

export type { AuthenticationResponseJSON, RegistrationResponseJSON };
