/**
 * End-to-end API flow tests for the humankey demo.
 * Uses a software FIDO2 authenticator (no real hardware key needed)
 * to exercise: challenge → register → credentials → challenge → verify.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHumanKeyHandlers, MemoryChallengeStore } from 'humankey/nextjs';
import type { TapCredential } from 'humankey/verify';
import { SoftAuthenticator } from './helpers/soft-authenticator';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3000';

// --- Hash helpers (replicate SDK internals for test proof construction) ---

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

async function sha256(data: string | Uint8Array): Promise<ArrayBuffer> {
  const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return crypto.subtle.digest('SHA-256', encoded);
}

function toBase64url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64url');
}

function fromBase64url(str: string): ArrayBuffer {
  const b = Buffer.from(str, 'base64url');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

async function hashAction(action: { action: string; data: Record<string, unknown> }): Promise<ArrayBuffer> {
  return sha256(canonicalize(action));
}

function deriveCode(hashBuf: ArrayBuffer): string {
  const bytes = new Uint8Array(hashBuf);
  const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    const value = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
    code += CHARSET[value % CHARSET.length];
  }
  return code;
}

async function combineAndHash(...buffers: ArrayBuffer[]): Promise<ArrayBuffer> {
  let totalLength = 0;
  for (const buf of buffers) totalLength += buf.byteLength;
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return crypto.subtle.digest('SHA-256', combined);
}

// --- Test setup ---

function setup() {
  const credentials = new Map<string, TapCredential>();

  const hk = createHumanKeyHandlers({
    rpID: RP_ID,
    rpName: 'HumanKey Demo',
    origin: ORIGIN,
    requireUserVerification: false,
    challengeStore: new MemoryChallengeStore(),
    getCredential: async (id) => credentials.get(id) ?? null,
    onRegister: async (cred) => {
      credentials.set(cred.id, cred);
    },
  });

  function getCredentialList() {
    return [...credentials.values()].map((c) => ({
      id: c.id,
      transports: c.transports,
    }));
  }

  function clearCredentials() {
    credentials.clear();
  }

  return { hk, credentials, getCredentialList, clearCredentials };
}

function makeRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function registerKey(hk: ReturnType<typeof setup>['hk'], authenticator: SoftAuthenticator) {
  const { challengeId, challenge } = await (await hk.challenge()).json();
  const regResponse = authenticator.register({
    challenge,
    rpId: RP_ID,
    rpName: 'HumanKey Demo',
    userId: Buffer.from('demo-user').toString('base64url'),
    userName: 'demo-user',
    origin: ORIGIN,
  });
  const res = await hk.register(
    makeRequest('http://localhost:3000/api/register', { response: regResponse, challengeId }),
  );
  return res.json();
}

// --- Tests ---

describe('Demo API flow', () => {
  let env: ReturnType<typeof setup>;
  let authenticator: SoftAuthenticator;

  beforeEach(() => {
    env = setup();
    authenticator = new SoftAuthenticator();
  });

  it('challenge endpoint returns challengeId and challenge', async () => {
    const res = await env.hk.challenge();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.challengeId).toBe('string');
    expect(typeof body.challenge).toBe('string');
  });

  it('register endpoint stores a credential', async () => {
    const body = await registerKey(env.hk, authenticator);
    expect(body.ok).toBe(true);
    expect(body.credentialId).toBeDefined();

    const creds = env.getCredentialList();
    expect(creds).toHaveLength(1);
    expect(creds[0].id).toBe(body.credentialId);
  });

  it('credentials list returns registered keys', async () => {
    expect(env.getCredentialList()).toHaveLength(0);
    await registerKey(env.hk, authenticator);

    const creds = env.getCredentialList();
    expect(creds).toHaveLength(1);
    expect(creds[0]).toHaveProperty('id');
    expect(creds[0]).toHaveProperty('transports');
  });

  it('clearCredentials removes all keys', async () => {
    await registerKey(env.hk, authenticator);
    expect(env.getCredentialList()).toHaveLength(1);

    env.clearCredentials();
    expect(env.getCredentialList()).toHaveLength(0);
  });

  it('full flow: register → confirm → tap → verify', async () => {
    // Step 1: Register
    await registerKey(env.hk, authenticator);

    // Step 2: Get challenge for action
    const { challengeId: actionChallengeId, challenge: actionChallenge } =
      await (await env.hk.challenge()).json();

    // Step 3: Create confirmation (simulate client-side)
    const action = { action: 'send-money', data: { recipient: 'alice@test.com', amount: 100 } };
    const actionHashBuf = await hashAction(action);
    const actionHash = toBase64url(actionHashBuf);
    const code = deriveCode(actionHashBuf);

    // Build confirmation hash (same as requestTap internals)
    const confirmationInput = `${code}:${code}`;
    const confirmationHashBuf = await sha256(confirmationInput);
    const confirmationHash = toBase64url(confirmationHashBuf);

    // Build the final combined challenge
    const finalChallenge = await combineAndHash(
      fromBase64url(actionChallenge),
      actionHashBuf,
      confirmationHashBuf,
    );

    // Step 4: Simulate hardware key tap
    const authResponse = authenticator.authenticate({
      challenge: toBase64url(finalChallenge),
      rpId: RP_ID,
      origin: ORIGIN,
      credentialId: authenticator.getCredentialId(),
      counter: 1,
    });

    // Step 5: Verify via handler
    const verifyRes = await env.hk.verify(
      makeRequest('http://localhost:3000/api/verify', {
        proof: {
          response: authResponse,
          action,
          actionHash,
          confirmationHash,
          userInput: code,
        },
        challengeId: actionChallengeId,
        action,
      }),
    );
    expect(verifyRes.status).toBe(200);

    const verifyBody = await verifyRes.json();
    expect(verifyBody.verified).toBe(true);
    expect(verifyBody.confirmationValid).toBe(true);
    expect(verifyBody.userVerified).toBe(true);
  });

  it('verify rejects missing challenge', async () => {
    const res = await env.hk.verify(
      makeRequest('http://localhost:3000/api/verify', {
        proof: { response: {}, action: {}, actionHash: '', confirmationHash: '', userInput: '' },
        challengeId: 'nonexistent',
        action: { action: 'test', data: {} },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Challenge not found');
  });

  it('register rejects missing challenge', async () => {
    const res = await env.hk.register(
      makeRequest('http://localhost:3000/api/register', {
        response: {},
        challengeId: 'nonexistent',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Challenge not found');
  });
});
