// Fastify entrypoint. Boots keyless under MOCK_MODE=1. The composition root (`start()`) is the
// ONE place that constructs concrete providers from Env and injects them into `buildServer`.
import Anthropic from '@anthropic-ai/sdk';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { MockASRProvider, MockFormatter, UndertoneError, toErrorMessage } from '@undertone/shared';
import { DeepgramASRProvider } from './asr/deepgram';
import { HaikuFormatter } from './format';
import { type Env, loadEnv } from './env';
import { MockAuthenticator, registerSessionTokenRoute } from './routes/session-token';
import { registerWsGateway, type GatewayDeps } from './ws';

export interface HealthResponse {
  ok: true;
  mock: boolean;
}

/**
 * Build a Fastify instance bound to the given environment. Pure — does not listen.
 *
 * `gateway` supplies the injected ASRProvider + Formatter (Tasks 1d/1e). When present, the WS
 * gateway (/v1/stream) is registered. It is optional so the server can still expose /healthz and
 * POST /v1/session/token without a pipeline (e.g. narrow route tests). The composition root
 * (`start()`) always injects the Env-selected providers.
 */
export function buildServer(env: Env, gateway?: GatewayDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', (): HealthResponse => ({ ok: true, mock: env.mock }));

  // POST /v1/session/token (§5). MOCK_MODE authenticates every caller as the fixed mock user;
  // the Clerk-backed Authenticator swaps in at the same seam in Phase 3. The HS256 signing secret
  // is plumbed from the typed Env (§10).
  registerSessionTokenRoute(app, new MockAuthenticator(), env.sessionJwtSecret);

  // WS gateway (§4). Registered only once its injected providers are supplied. The gateway
  // verifies session JWTs with the same Env secret the token route signs them with (§4.1).
  if (gateway) {
    registerWsGateway(app, gateway, env.sessionJwtSecret);
  }

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

/**
 * Construct the pipeline providers for the loaded Env (ARCHITECTURE §5). MOCK_MODE=1 →
 * fixture-driven MockASRProvider + deterministic MockFormatter from @undertone/shared (keyless).
 * Real mode → DeepgramASRProvider(env.deepgramApiKey) + HaikuFormatter(env.anthropicApiKey).
 */
export function buildGatewayDeps(env: Env): GatewayDeps {
  if (env.mock) {
    return { asrProvider: new MockASRProvider(), formatter: new MockFormatter() };
  }
  return {
    asrProvider: new DeepgramASRProvider({ apiKey: env.deepgramApiKey }),
    formatter: new HaikuFormatter({ client: new Anthropic({ apiKey: env.anthropicApiKey }) }),
  };
}

/** Load env, build the server, and start listening. Used when run as the process entrypoint. */
export async function start(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = buildServer(env, buildGatewayDeps(env));
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
