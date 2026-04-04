import { describe, it, expect } from 'vitest';
import { createChallenge } from '../src/challenge.js';

describe('createChallenge', () => {
  it('returns a valid base64url string', () => {
    const challenge = createChallenge();
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns correct length for default 32 bytes', () => {
    const challenge = createChallenge();
    // 32 bytes = 43 base64url chars (no padding)
    expect(challenge.length).toBe(43);
  });

  it('returns different values on each call', () => {
    const a = createChallenge();
    const b = createChallenge();
    expect(a).not.toBe(b);
  });

  it('supports custom byte length', () => {
    const challenge = createChallenge(16);
    // 16 bytes = 22 base64url chars
    expect(challenge.length).toBe(22);
  });
});
