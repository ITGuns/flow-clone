// Fastify entrypoint. Boots keyless under MOCK_MODE=1. Real routes (WS gateway, REST §5)
// arrive with their Phase 1+ tasks; this scaffold exposes only GET /healthz.
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { UndertoneError, toErrorMessage } from '@undertone/shared';
import { type Env, loadEnv } from './env';

export interface HealthResponse {
  ok: true;
  mock: boolean;
}

/** Build a Fastify instance bound to the given environment. Pure — does not listen. */
export function buildServer(env: Env): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', (): HealthResponse => ({ ok: true, mock: env.mock }));

  // Surface application errors on the same shape the WS `error` frame uses (§4.3/§8).
  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof UndertoneError) {
      void reply.status(400).send(toErrorMessage(error));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    void reply.status(500).send({ t: 'error', code: 'INTERNAL', message, retryable: false });
  });

  return app;
}

/** Load env, build the server, and start listening. Used when run as the process entrypoint. */
export async function start(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = buildServer(env);
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  return app;
}

// Start only when invoked directly (`tsx src/index.ts`), never when imported by tests.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  start().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
