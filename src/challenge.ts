import { bufferToBase64url } from './hash.js';

/**
 * Generate a cryptographically random challenge string (base64url).
 * Use this server-side to create challenges for registration and tap flows.
 *
 * @param byteLength Number of random bytes (default: 32, producing a 256-bit challenge)
 * @returns A base64url-encoded random challenge string
 */
export function createChallenge(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bufferToBase64url(bytes.buffer);
}
