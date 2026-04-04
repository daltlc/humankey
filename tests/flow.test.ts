import { describe, it, expect } from 'vitest';
import { createConfirmation, validateConfirmation } from '../src/confirm.js';
import {
  hashAction,
  combineAndHash,
  bufferToBase64url,
  base64urlToBuffer,
} from '../src/hash.js';
import type { ActionPayload } from '../src/types.js';

/**
 * Integration test: simulates the full confirm→challenge-binding flow
 * without actual WebAuthn calls (those require a browser + hardware key).
 * Verifies that the cryptographic chain is correct end-to-end.
 */
describe('full flow (confirm → challenge binding → verify chain)', () => {
  const action: ActionPayload = {
    action: 'send-payment',
    data: { to: 'bob', amount: 50, currency: 'USD' },
  };

  it('confirmation code is deterministic and verifiable', async () => {
    const confirmation = await createConfirmation(action);

    // User types the correct code
    expect(() => validateConfirmation(confirmation, confirmation.code)).not.toThrow();

    // Re-deriving from the same action gives the same code
    const confirmation2 = await createConfirmation(action);
    expect(confirmation2.code).toBe(confirmation.code);
    expect(confirmation2.actionHash).toBe(confirmation.actionHash);
  });

  it('challenge binding combines server challenge + action + confirmation', async () => {
    const serverChallenge = crypto.getRandomValues(new Uint8Array(32));
    const confirmation = await createConfirmation(action);

    // Simulate what requestTap() does internally
    const actionHashBuffer = await hashAction(action);
    const confirmationInput = `${confirmation.code}:${confirmation.code}`;
    const confirmationHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(confirmationInput),
    );

    const finalChallenge = await combineAndHash(
      serverChallenge.buffer,
      actionHashBuffer,
      confirmationHashBuffer,
    );

    // The final challenge should be a 32-byte SHA-256
    expect(finalChallenge.byteLength).toBe(32);

    // Simulate what verifyTapProof() does — re-derive the same final challenge
    const reDerivedActionHash = await hashAction(action);
    const reDerivedConfirmationHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(confirmationInput),
    );
    const reDerivedFinal = await combineAndHash(
      serverChallenge.buffer,
      reDerivedActionHash,
      reDerivedConfirmationHash,
    );

    // Server's re-derived challenge must match what the client signed
    expect(bufferToBase64url(reDerivedFinal)).toBe(
      bufferToBase64url(finalChallenge),
    );
  });

  it('different actions produce different final challenges', async () => {
    const serverChallenge = crypto.getRandomValues(new Uint8Array(32));

    const action1: ActionPayload = { action: 'send', data: { amount: 10 } };
    const action2: ActionPayload = { action: 'send', data: { amount: 10000 } };

    const c1 = await createConfirmation(action1);
    const c2 = await createConfirmation(action2);

    const hash1 = await hashAction(action1);
    const hash2 = await hashAction(action2);

    const confHash1 = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${c1.code}:${c1.code}`),
    );
    const confHash2 = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${c2.code}:${c2.code}`),
    );

    const final1 = await combineAndHash(serverChallenge.buffer, hash1, confHash1);
    const final2 = await combineAndHash(serverChallenge.buffer, hash2, confHash2);

    expect(bufferToBase64url(final1)).not.toBe(bufferToBase64url(final2));
  });

  it('tampered action is detectable via hash mismatch', async () => {
    const realAction: ActionPayload = { action: 'send', data: { amount: 10 } };
    const fakeAction: ActionPayload = { action: 'send', data: { amount: 10000 } };

    const realHash = bufferToBase64url(await hashAction(realAction));
    const fakeHash = bufferToBase64url(await hashAction(fakeAction));

    // The hashes differ — server can detect the mismatch
    expect(realHash).not.toBe(fakeHash);
  });
});
