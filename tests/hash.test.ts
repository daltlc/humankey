import { describe, it, expect } from 'vitest';
import {
  hashAction,
  deriveConfirmationCode,
  bufferToBase64url,
  base64urlToBuffer,
  combineAndHash,
} from '../src/hash.js';
import type { ActionPayload } from '../src/types.js';

describe('hashAction', () => {
  it('produces deterministic output for the same action', async () => {
    const action: ActionPayload = {
      action: 'send-message',
      data: { to: 'bob', body: 'hello' },
    };
    const hash1 = await hashAction(action);
    const hash2 = await hashAction(action);
    expect(bufferToBase64url(hash1)).toBe(bufferToBase64url(hash2));
  });

  it('produces different output for different actions', async () => {
    const action1: ActionPayload = {
      action: 'send-message',
      data: { to: 'bob', body: 'hello' },
    };
    const action2: ActionPayload = {
      action: 'send-message',
      data: { to: 'bob', body: 'goodbye' },
    };
    const hash1 = await hashAction(action1);
    const hash2 = await hashAction(action2);
    expect(bufferToBase64url(hash1)).not.toBe(bufferToBase64url(hash2));
  });

  it('is key-order independent (canonical JSON)', async () => {
    const action1: ActionPayload = {
      action: 'send',
      data: { to: 'bob', amount: 10 },
    };
    const action2: ActionPayload = {
      action: 'send',
      data: { amount: 10, to: 'bob' },
    };
    const hash1 = await hashAction(action1);
    const hash2 = await hashAction(action2);
    expect(bufferToBase64url(hash1)).toBe(bufferToBase64url(hash2));
  });

  it('produces a 32-byte SHA-256 hash', async () => {
    const action: ActionPayload = { action: 'test', data: {} };
    const hash = await hashAction(action);
    expect(hash.byteLength).toBe(32);
  });
});

describe('deriveConfirmationCode', () => {
  it('produces a 4-character alphanumeric code', async () => {
    const action: ActionPayload = { action: 'test', data: { foo: 'bar' } };
    const hash = await hashAction(action);
    const code = deriveConfirmationCode(hash);
    expect(code).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('is deterministic for the same hash', async () => {
    const action: ActionPayload = { action: 'test', data: { foo: 'bar' } };
    const hash = await hashAction(action);
    const code1 = deriveConfirmationCode(hash);
    const code2 = deriveConfirmationCode(hash);
    expect(code1).toBe(code2);
  });

  it('produces different codes for different actions', async () => {
    const hash1 = await hashAction({ action: 'a', data: {} });
    const hash2 = await hashAction({ action: 'b', data: {} });
    const code1 = deriveConfirmationCode(hash1);
    const code2 = deriveConfirmationCode(hash2);
    expect(code1).not.toBe(code2);
  });

  it('uses all 36 characters across many inputs (distribution sanity)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const hash = await hashAction({ action: `action-${i}`, data: { i } });
      const code = deriveConfirmationCode(hash);
      for (const ch of code) seen.add(ch);
    }
    // All 36 characters should appear in 800 character samples
    expect(seen.size).toBe(36);
  });

  it('handles pathological hash where first bytes are all >= 252', () => {
    // All 32 bytes are 255 — every byte should be rejected, triggering re-hash fallback
    const pathological = new Uint8Array(32).fill(255);
    const code = deriveConfirmationCode(pathological.buffer);
    expect(code).toMatch(/^[0-9A-Z]{4}$/);
    expect(code.length).toBe(4);
  });
});

describe('bufferToBase64url / base64urlToBuffer', () => {
  it('round-trips correctly', () => {
    const original = new Uint8Array([1, 2, 3, 255, 0, 128]);
    const encoded = bufferToBase64url(original.buffer);
    const decoded = new Uint8Array(base64urlToBuffer(encoded));
    expect(decoded).toEqual(original);
  });

  it('produces URL-safe characters (no +, /, =)', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i * 8;
    const encoded = bufferToBase64url(bytes.buffer);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('combineAndHash', () => {
  it('produces a 32-byte hash', async () => {
    const a = new Uint8Array([1, 2, 3]).buffer;
    const b = new Uint8Array([4, 5, 6]).buffer;
    const result = await combineAndHash(a, b);
    expect(result.byteLength).toBe(32);
  });

  it('is order-dependent', async () => {
    const a = new Uint8Array([1, 2, 3]).buffer;
    const b = new Uint8Array([4, 5, 6]).buffer;
    const hash1 = await combineAndHash(a, b);
    const hash2 = await combineAndHash(b, a);
    expect(bufferToBase64url(hash1)).not.toBe(bufferToBase64url(hash2));
  });
});
