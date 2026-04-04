import type { ActionPayload } from './types.js';

/**
 * SHA-256 hash of canonicalized action JSON.
 * Canonical form: keys sorted alphabetically, no whitespace.
 * Works in both browser and Node.js (via globalThis.crypto).
 */
export async function hashAction(action: ActionPayload): Promise<ArrayBuffer> {
  const canonical = canonicalize(action);
  const encoded = new TextEncoder().encode(canonical);
  return crypto.subtle.digest('SHA-256', encoded);
}

/**
 * Combine multiple buffers and hash them together with SHA-256.
 * Used to bind challenge + actionHash + confirmationHash into a single WebAuthn challenge.
 */
export async function combineAndHash(
  ...buffers: ArrayBuffer[]
): Promise<ArrayBuffer> {
  let totalLength = 0;
  for (const buf of buffers) {
    totalLength += buf.byteLength;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  return crypto.subtle.digest('SHA-256', combined);
}

/**
 * Derive a 4-character alphanumeric confirmation code from an action hash.
 * Uses 16-bit values (2 bytes per character) to minimize modulo bias:
 * 65536 % 36 = 16, giving a bias of ~0.024% — negligible for a 4-char code.
 *
 * Entropy: ~20.68 bits (log2(36^4)). Rate-limiting confirmation attempts
 * is required to make brute force infeasible.
 */
export function deriveConfirmationCode(hashBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(hashBuffer);
  const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    // Combine two bytes into a 16-bit value for near-uniform distribution
    const value = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
    code += CHARSET[value % CHARSET.length];
  }
  return code;
}

/** Convert ArrayBuffer to base64url string */
export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Convert base64url string to ArrayBuffer */
export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Deterministic JSON canonicalization with sorted keys.
 * Handles nested objects recursively.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => JSON.stringify(key) + ':' + canonicalize(obj[key]));
  return '{' + pairs.join(',') + '}';
}
