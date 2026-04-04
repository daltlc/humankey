export { createConfirmation, validateConfirmation } from './confirm.js';
export { requestTap } from './tap.js';
export { registerKey } from './register.js';
export { isHumanKeySupported } from './support.js';
export { hashAction } from './hash.js';
export { HumanKeyError } from './errors.js';
export type {
  ActionPayload,
  Confirmation,
  TapRequest,
  TapProof,
  TapCredential,
  RegisterKeyRequest,
  RegistrationResult,
  VerifyResult,
  VerifyTapProofRequest,
} from './types.js';
export type { HumanKeyErrorCode } from './errors.js';
