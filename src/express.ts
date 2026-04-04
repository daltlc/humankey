import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifyTapProof } from './verify.js';
import { verifyRegistration } from './registration-verify.js';
import { createChallenge } from './challenge.js';
import { HumanKeyError } from './errors.js';
import type { TapCredential, VerifyResult, ActionPayload } from './types.js';

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

/** Configuration for the humankey Express router. */
export interface HumanKeyExpressConfig {
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

/**
 * Create an Express Router with pre-built humankey routes.
 *
 * Routes:
 * - POST /challenge — generate and store a challenge
 * - POST /register — verify registration and store credential
 * - POST /verify — verify a tap proof
 */
export function createHumanKeyRouter(config: HumanKeyExpressConfig): Router {
  const {
    rpID,
    origin,
    challengeTTL = 60_000,
    challengeStore = new MemoryChallengeStore(),
    getCredential,
    onRegister,
    onVerify,
    requireUserVerification = true,
    allowedAAGUIDs,
  } = config;

  const router = Router();

  router.post('/challenge', async (_req: Request, res: Response) => {
    try {
      const challenge = createChallenge();
      const challengeId = crypto.randomUUID();
      await challengeStore.set(challengeId, challenge, challengeTTL);
      res.json({ challengeId, challenge });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { response, challengeId } = req.body;

      const challenge = await challengeStore.get(challengeId);
      if (!challenge) {
        res.status(400).json({ error: 'Challenge not found or expired' });
        return;
      }

      const result = await verifyRegistration({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification,
        allowedAAGUIDs,
      });

      await onRegister(result.credential);
      res.json({ ok: true, credentialId: result.credential.id });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.post('/verify', async (req: Request, res: Response) => {
    try {
      const { proof, challengeId, action } = req.body;

      const challenge = await challengeStore.get(challengeId);
      if (!challenge) {
        res.status(400).json({ error: 'Challenge not found or expired' });
        return;
      }

      const credential = await getCredential(proof.response?.id);
      if (!credential) {
        res.status(400).json({ error: 'Credential not found' });
        return;
      }

      const result = await verifyTapProof({
        proof,
        credential,
        expectedChallenge: challenge,
        expectedAction: action,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification,
      });

      credential.counter = result.newCounter;

      if (onVerify) {
        await onVerify(result, action);
      }

      res.json({
        verified: result.verified,
        confirmationValid: result.confirmationValid,
        userVerified: result.userVerified,
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  return router;
}

function handleError(res: Response, error: unknown): void {
  if (error instanceof HumanKeyError) {
    res.status(400).json({ error: error.message, code: error.code });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export type { TapCredential, VerifyResult, ActionPayload };
