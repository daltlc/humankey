import { describe, it, expect } from 'vitest';
import { createConfirmation, validateConfirmation } from '../src/confirm.js';
import { HumanKeyError } from '../src/errors.js';
import type { ActionPayload } from '../src/types.js';

describe('createConfirmation', () => {
  const action: ActionPayload = {
    action: 'send-message',
    data: { to: 'bob', body: 'hello' },
  };

  it('returns a 4-char alphanumeric code', async () => {
    const confirmation = await createConfirmation(action);
    expect(confirmation.code).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('returns a base64url action hash', async () => {
    const confirmation = await createConfirmation(action);
    expect(confirmation.actionHash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for the same action', async () => {
    const c1 = await createConfirmation(action);
    const c2 = await createConfirmation(action);
    expect(c1.code).toBe(c2.code);
    expect(c1.actionHash).toBe(c2.actionHash);
  });

  it('produces different codes for different actions', async () => {
    const otherAction: ActionPayload = {
      action: 'send-message',
      data: { to: 'eve', body: 'different' },
    };
    const c1 = await createConfirmation(action);
    const c2 = await createConfirmation(otherAction);
    expect(c1.code).not.toBe(c2.code);
  });
});

describe('validateConfirmation', () => {
  it('passes when input matches the code (exact)', async () => {
    const action: ActionPayload = { action: 'test', data: {} };
    const confirmation = await createConfirmation(action);
    expect(() => validateConfirmation(confirmation, confirmation.code)).not.toThrow();
  });

  it('passes when input matches case-insensitively', async () => {
    const action: ActionPayload = { action: 'test', data: {} };
    const confirmation = await createConfirmation(action);
    expect(() =>
      validateConfirmation(confirmation, confirmation.code.toLowerCase()),
    ).not.toThrow();
  });

  it('passes with leading/trailing whitespace', async () => {
    const action: ActionPayload = { action: 'test', data: {} };
    const confirmation = await createConfirmation(action);
    expect(() =>
      validateConfirmation(confirmation, `  ${confirmation.code}  `),
    ).not.toThrow();
  });

  it('throws CONFIRMATION_MISMATCH on wrong input', async () => {
    const action: ActionPayload = { action: 'test', data: {} };
    const confirmation = await createConfirmation(action);
    expect(() => validateConfirmation(confirmation, 'XXXX')).toThrow(HumanKeyError);
    try {
      validateConfirmation(confirmation, 'XXXX');
    } catch (e) {
      expect((e as HumanKeyError).code).toBe('CONFIRMATION_MISMATCH');
    }
  });

  it('does not leak the expected code in the error message', async () => {
    const action: ActionPayload = { action: 'test', data: {} };
    const confirmation = await createConfirmation(action);
    try {
      validateConfirmation(confirmation, 'XXXX');
    } catch (e) {
      const message = (e as HumanKeyError).message;
      expect(message).not.toContain(confirmation.code);
      expect(message).not.toContain('XXXX');
    }
  });
});
