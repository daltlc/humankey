import { verifyTapProof } from './verify.js';
import { verifyRegistration } from './registration-verify.js';
import { createChallenge } from './challenge.js';
import { HumanKeyError } from './errors.js';
import type { TapCredential, TapProof, VerifyResult, ActionPayload } from './types.js';

/** Abstraction for challenge storage with TTL and single-use semantics. */
export interface ChallengeStore {
  /** Store a challenge with a TTL. */
  set(id: string, challenge: string, ttlMs: number): Promise<void>;
  /** Retrieve and delete a challenge (single-use). Returns null if expired or not found. */
  get(id: string): Promise<string | null>;
}

/** In-memory challenge store with TTL enforcement. Use a database or Redis in production. */
export class MemoryChallengeStore implements ChallengeStore {
  private store = new Map<string, { challenge: string; expiresAt: number }>();

  async set(id: string, challenge: string, ttlMs: number): Promise<void> {
    this.store.set(id, { challenge, expiresAt: Date.now() + ttlMs });
    this.cleanup();
  }

  async get(id: string): Promise<string | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    this.store.delete(id);
    if (Date.now() > entry.expiresAt) return null;
    return entry.challenge;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(id);
    }
  }
}

/** Shared configuration for all framework adapters. */
export interface HumanKeyAdapterConfig {
  /** Relying party ID, e.g. "example.com" */
  rpID: string;
  /** Relying party display name */
  rpName: string;
  /** Expected origin(s), e.g. "https://example.com" */
  origin: string | string[];
  /** Challenge TTL in ms (default: 60000) */
  challengeTTL?: number;
  /** Custom challenge store (default: MemoryChallengeStore) */
  challengeStore?: ChallengeStore;
  /** Look up a stored credential by ID */
  getCredential: (credentialId: string) => Promise<TapCredential | null>;
  /** Called after successful registration — store the credential */
  onRegister: (credential: TapCredential) => Promise<void>;
  /** Called after successful tap verification */
  onVerify?: (result: VerifyResult, action: ActionPayload) => Promise<void>;
  /** Require user verification (default: true) */
  requireUserVerification?: boolean;
  /** Restrict to specific authenticator models by AAGUID */
  allowedAAGUIDs?: string[];
}

export interface ResolvedConfig {
  rpID: string;
  rpName: string;
  origin: string | string[];
  challengeTTL: number;
  challengeStore: ChallengeStore;
  getCredential: (credentialId: string) => Promise<TapCredential | null>;
  onRegister: (credential: TapCredential) => Promise<void>;
  onVerify?: (result: VerifyResult, action: ActionPayload) => Promise<void>;
  requireUserVerification: boolean;
  allowedAAGUIDs?: string[];
}

/** Resolve defaults for adapter config. */
export function resolveConfig(config: HumanKeyAdapterConfig): ResolvedConfig {
  return {
    rpID: config.rpID,
    rpName: config.rpName,
    origin: config.origin,
    challengeTTL: config.challengeTTL ?? 60_000,
    challengeStore: config.challengeStore ?? new MemoryChallengeStore(),
    getCredential: config.getCredential,
    onRegister: config.onRegister,
    onVerify: config.onVerify,
    requireUserVerification: config.requireUserVerification ?? true,
    allowedAAGUIDs: config.allowedAAGUIDs,
  };
}

/** Result types for handler responses. */
export type HandlerResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400; body: { error: string; code?: string } }
  | { status: 500; body: { error: string } };

/** Generate and store a challenge. */
export async function handleChallenge(config: ResolvedConfig): Promise<HandlerResult> {
  try {
    const challenge = createChallenge();
    const challengeId = crypto.randomUUID();
    await config.challengeStore.set(challengeId, challenge, config.challengeTTL);
    return { status: 200, body: { challengeId, challenge } };
  } catch {
    return { status: 500, body: { error: 'Internal server error' } };
  }
}

/** Verify a registration response and store the credential. */
export async function handleRegister(
  config: ResolvedConfig,
  body: { response: unknown; challengeId: string },
): Promise<HandlerResult> {
  try {
    const challenge = await config.challengeStore.get(body.challengeId);
    if (!challenge) {
      return { status: 400, body: { error: 'Challenge not found or expired' } };
    }

    const result = await verifyRegistration({
      response: body.response as Parameters<typeof verifyRegistration>[0]['response'],
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: config.requireUserVerification,
      allowedAAGUIDs: config.allowedAAGUIDs,
    });

    await config.onRegister(result.credential);
    return { status: 200, body: { ok: true, credentialId: result.credential.id } };
  } catch (error) {
    return errorResult(error);
  }
}

/** Verify a tap proof. */
export async function handleVerify(
  config: ResolvedConfig,
  body: { proof: TapProof; challengeId: string; action: ActionPayload },
): Promise<HandlerResult> {
  try {
    const challenge = await config.challengeStore.get(body.challengeId);
    if (!challenge) {
      return { status: 400, body: { error: 'Challenge not found or expired' } };
    }

    const proof = body.proof;
    const credential = await config.getCredential(proof.response?.id);
    if (!credential) {
      return { status: 400, body: { error: 'Credential not found' } };
    }

    const result = await verifyTapProof({
      proof,
      credential,
      expectedChallenge: challenge,
      expectedAction: body.action,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: config.requireUserVerification,
    });

    credential.counter = result.newCounter;

    if (config.onVerify) {
      await config.onVerify(result, body.action);
    }

    return {
      status: 200,
      body: {
        verified: result.verified,
        confirmationValid: result.confirmationValid,
        userVerified: result.userVerified,
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

function errorResult(error: unknown): HandlerResult {
  if (error instanceof HumanKeyError) {
    return { status: 400, body: { error: error.message, code: error.code } };
  }
  return { status: 500, body: { error: 'Internal server error' } };
}

export type { TapCredential, VerifyResult, ActionPayload };
