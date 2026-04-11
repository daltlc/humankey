import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
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

/** Configuration for the humankey Fastify plugin. */
export type HumanKeyFastifyConfig = HumanKeyAdapterConfig;

/**
 * Fastify plugin that registers humankey routes.
 *
 * Usage:
 * ```ts
 * import Fastify from 'fastify';
 * import { humanKeyPlugin } from 'humankey/fastify';
 * const app = Fastify();
 * app.register(humanKeyPlugin, { prefix: '/api', ...config });
 * ```
 */
export const humanKeyPlugin: FastifyPluginAsync<HumanKeyFastifyConfig> = async (
  fastify: FastifyInstance,
  config: HumanKeyFastifyConfig,
) => {
  const resolved = resolveConfig(config);

  fastify.post('/challenge', async (_request, reply) => {
    const result = await handleChallenge(resolved);
    return reply.status(result.status).send(result.body);
  });

  fastify.post('/register', async (request, reply) => {
    const result = await handleRegister(resolved, request.body as Parameters<typeof handleRegister>[1]);
    return reply.status(result.status).send(result.body);
  });

  fastify.post('/verify', async (request, reply) => {
    const result = await handleVerify(resolved, request.body as Parameters<typeof handleVerify>[1]);
    return reply.status(result.status).send(result.body);
  });
};

export { MemoryChallengeStore };
export type { ChallengeStore, TapCredential, VerifyResult, ActionPayload };
