import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  resolveConfig,
  handleChallenge,
  handleRegister,
  handleVerify,
  MemoryChallengeStore,
} from './adapter-core.js';
import type {
  HumanKeyAdapterConfig,
  ChallengeStore,
  HandlerResult,
} from './adapter-core.js';
import type { TapCredential, VerifyResult, ActionPayload } from './types.js';

/** Configuration for the humankey Express router. */
export type HumanKeyExpressConfig = HumanKeyAdapterConfig;

/**
 * Create an Express Router with pre-built humankey routes.
 *
 * Routes:
 * - POST /challenge — generate and store a challenge
 * - POST /register — verify registration and store credential
 * - POST /verify — verify a tap proof
 */
export function createHumanKeyRouter(config: HumanKeyExpressConfig): Router {
  const resolved = resolveConfig(config);
  const router = Router();

  router.post('/challenge', async (_req: Request, res: Response) => {
    const result = await handleChallenge(resolved);
    sendResult(res, result);
  });

  router.post('/register', async (req: Request, res: Response) => {
    const result = await handleRegister(resolved, req.body);
    sendResult(res, result);
  });

  router.post('/verify', async (req: Request, res: Response) => {
    const result = await handleVerify(resolved, req.body);
    sendResult(res, result);
  });

  return router;
}

function sendResult(res: Response, result: HandlerResult): void {
  res.status(result.status).json(result.body);
}

export { MemoryChallengeStore };
export type { ChallengeStore, TapCredential, VerifyResult, ActionPayload };
