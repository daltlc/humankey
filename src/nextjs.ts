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

/** Configuration for the humankey Next.js adapter. */
export type HumanKeyNextConfig = HumanKeyAdapterConfig;

/**
 * Create Next.js App Router route handlers for humankey.
 *
 * Usage (one file per route):
 * ```ts
 * // app/api/humankey/challenge/route.ts
 * import { createHumanKeyHandlers } from 'humankey/nextjs';
 * const hk = createHumanKeyHandlers({ ... });
 * export const POST = hk.challenge;
 * ```
 */
export function createHumanKeyHandlers(config: HumanKeyNextConfig) {
  const resolved = resolveConfig(config);

  return {
    /** POST handler for /challenge — generates and stores a challenge. */
    challenge: async (): Promise<Response> => {
      const result = await handleChallenge(resolved);
      return toResponse(result);
    },

    /** POST handler for /register — verifies registration and stores credential. */
    register: async (req: Request): Promise<Response> => {
      const body = await req.json();
      const result = await handleRegister(resolved, body);
      return toResponse(result);
    },

    /** POST handler for /verify — verifies a tap proof. */
    verify: async (req: Request): Promise<Response> => {
      const body = await req.json();
      const result = await handleVerify(resolved, body);
      return toResponse(result);
    },
  };
}

function toResponse(result: HandlerResult): Response {
  return Response.json(result.body, { status: result.status });
}

export { MemoryChallengeStore };
export type { ChallengeStore, TapCredential, VerifyResult, ActionPayload };
