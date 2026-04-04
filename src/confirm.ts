import type { ActionPayload, Confirmation } from './types.js';
import { hashAction, deriveConfirmationCode, bufferToBase64url } from './hash.js';
import { HumanKeyError } from './errors.js';

/**
 * Generate a confirmation challenge for an action.
 * Returns a Confirmation containing a 4-char code derived from the action hash.
 * The developer shows this code in their UI and asks the user to type it back.
 */
export async function createConfirmation(
  action: ActionPayload,
): Promise<Confirmation> {
  const hashBuffer = await hashAction(action);
  const code = deriveConfirmationCode(hashBuffer);
  const actionHash = bufferToBase64url(hashBuffer);
  return { code, actionHash };
}

/**
 * Validate that the user's input matches the expected confirmation code.
 * Case-insensitive comparison.
 * Throws CONFIRMATION_MISMATCH if the input doesn't match.
 */
export function validateConfirmation(
  confirmation: Confirmation,
  userInput: string,
): void {
  if (userInput.toUpperCase().trim() !== confirmation.code.toUpperCase()) {
    throw new HumanKeyError(
      'Confirmation code mismatch',
      'CONFIRMATION_MISMATCH',
    );
  }
}
