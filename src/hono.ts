import { Hono } from 'hono';
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

/** Configuration for the humankey Hono adapter. */
export type HumanKeyHonoConfig = HumanKeyAdapterConfig;

/**
 * Create a Hono app with humankey routes.
 *
 * Usage:
 * ```ts
 * import { Hono } from 'hono';
 * import { createHumanKeyApp } from 'humankey/hono';
 * const app = new Hono();
 * app.route('/api', createHumanKeyApp({ ... }));
 * ```
 */
export function createHumanKeyApp(config: HumanKeyHonoConfig): Hono {
  const resolved = resolveConfig(config);
  const app = new Hono();

  app.post('/challenge', async (c) => {
    const result = await handleChallenge(resolved);
    return c.json(result.body, result.status as 200);
  });

  app.post('/register', async (c) => {
    const body = await c.req.json();
    const result = await handleRegister(resolved, body);
    return c.json(result.body, result.status as 200);
  });

  app.post('/verify', async (c) => {
    const body = await c.req.json();
    const result = await handleVerify(resolved, body);
    return c.json(result.body, result.status as 200);
  });

  return app;
}

export { MemoryChallengeStore };
export type { ChallengeStore, TapCredential, VerifyResult, ActionPayload };
