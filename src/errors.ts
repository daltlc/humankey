export type HumanKeyErrorCode =
  | 'CONFIRMATION_MISMATCH'
  | 'VERIFICATION_FAILED'
  | 'USER_VERIFICATION_MISSING'
  | 'COUNTER_REPLAY'
  | 'CHALLENGE_MISMATCH'
  | 'ACTION_HASH_MISMATCH'
  | 'WEBAUTHN_NOT_SUPPORTED'
  | 'USER_CANCELLED'
  | 'REGISTRATION_FAILED'
  | 'AAGUID_NOT_ALLOWED';

export class HumanKeyError extends Error {
  public readonly code: HumanKeyErrorCode;

  constructor(message: string, code: HumanKeyErrorCode, cause?: unknown) {
    super(message);
    this.name = 'HumanKeyError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
