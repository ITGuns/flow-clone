// Fastify entrypoint + composition root. Boots keyless under MOCK_MODE=1. `buildComposition` is the
// ONE place that constructs concrete providers/repos/stores from Env and wires them — per mode —
// into the gateway pipeline hooks (§6 dictionary, §7 persistence, §7/§8 metering) and the REST
// routes (§5). Everything sits behind ONE Authenticator instance so the same identity gates REST
// and WS. `buildServer` stays a thin router that registers what the composition hands it.
import Anthropic from '@anthropic-ai/sdk';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { MockASRProvider, MockFormatter, UndertoneError, toErrorMessage } from '@undertone/shared';
import { DeepgramASRProvider } from './asr/deepgram';
import { HaikuFormatter } from './format';
import { type Env, loadEnv } from './env';
import {
  MockAuthenticator,
  registerSessionTokenRoute,
  type Authenticator,
} from './routes/session-token';
import {
  registerWsGateway,
  type GatewayDeps,
  type LoadDictionaryHook,
  type MeterHook,
  type PersistHook,
} from './ws';
import {
  ClerkAuthenticator,
  ClerkBackendVerifier,
  DrizzleUserStore,
  InMemorySubscriptionReader,
  InMemoryUserStore,
  type SubscriptionReader,
  type SubscriptionRecord,
  type UsageReader,
  type UserStore,
} from './auth';
import { registerMeRoute } from './routes/me';
import { registerDictionaryRoutes } from './routes/dictionary';
import { registerHistoryRoutes } from './routes/history';
import { registerBillingRoutes, registerStripeWebhookRoute } from './routes/stripe';
import {
  DictionaryStore,
  DrizzleDictionaryRepo,
  InMemoryDictionaryRepo,
  loadDictionaryForUser,
} from './dictionary';
import {
  DrizzleTranscriptRepo,
  InMemoryTranscriptRepo,
  TranscriptStore,
  createTranscriptStore,
  persistTranscript,
} from './history';
import {
  DrizzleUsageRepo,
  FakeUsageRepo,
  InMemoryRedis,
  UsageCounter,
  createRedis,
  meterUsage,
  weekStartMondayUtc,
  type UsageRepo,
} from './usage';
import {
  DrizzleSubscriptionRepo,
  DrizzleUserRepo,
  InMemorySubscriptionRepo,
  InMemoryUserRepo,
  StripeService,
  TRIAL_DAYS,
  createStripeClient,
  resolvePriceConfig,
  type SubscriptionRepo,
} from './billing';
import { getDb } from './db';

export interface HealthResponse {
  ok: true;
  mock: boolean;
}

/** The fixed MOCK_MODE principal (ARCHITECTURE §5). Its id is the token `sub`. */
export const MOCK_USER_ID = 'user_mock';

/** REST-route collaborators the composition hands to `buildServer` (all behind ONE authenticator). */
export interface AppRouteDeps {
  authenticator: Authenticator;
  userStore: UserStore;
  subscriptions: SubscriptionReader;
  usageReader: UsageReader;
  dictionaryStore: DictionaryStore;
  transcriptStore: TranscriptStore;
  stripeService: StripeService;
}

/**
 * Build a Fastify instance bound to the given environment. Pure — does not listen.
 *
 * `gateway` supplies the injected ASRProvider + Formatter (+ Phase 3 pipeline hooks) — when present
 * the WS gateway (/v1/stream) is registered. `appDeps` supplies the REST-route collaborators — when
 * present the §5 routes (me, dictionary, history, stripe webhook, billing checkout) are registered
 * behind `appDeps.authenticator`, which also gates the session-token route. Both are optional so a
 * narrow test can still boot /healthz + POST /v1/session/token with the fallback mock authenticator.
 */
export function buildServer(
  env: Env,
  gateway?: GatewayDeps,
  appDeps?: AppRouteDeps,
): FastifyInstance {
  const app = Fastify({ logger: false });

  // CORS for the web dashboard (apps/web, task 4h). Additive: allows the Vite dev origin plus an
  // optional `WEB_ORIGIN` (the deployed dashboard origin in real mode). Enables the browser to POST
  // /v1/session/token and read /v1/me + /v1/history cross-origin. Existing routes/tests are
  // unaffected — same-origin (app.inject) requests carry no Origin header and are never blocked.
  const webOrigin = process.env.WEB_ORIGIN;
  const allowedOrigins = ['http://localhost:5173', ...(webOrigin ? [webOrigin] : [])];
  void app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.get('/healthz', (): HealthResponse => ({ ok: true, mock: env.mock }));

  // One Authenticator gates every authenticated surface (§4.1/§5). Falls back to the mock
  // authenticator when no composition is supplied (narrow route tests).
  const authenticator: Authenticator = appDeps?.authenticator ?? new MockAuthenticator();

  // POST /v1/session/token (§5) — mints the WS session JWT (§4.1) with the Env signing secret.
  registerSessionTokenRoute(app, authenticator, env.sessionJwtSecret);

  // §5 REST surface — registered only when the composition supplies the stores.
  if (appDeps) {
    registerMeRoute(app, {
      authenticator,
      store: appDeps.userStore,
      usage: appDeps.usageReader,
      subscriptions: appDeps.subscriptions,
    });
    registerDictionaryRoutes(app, { store: appDeps.dictionaryStore, authenticator });
    registerHistoryRoutes(app, { store: appDeps.transcriptStore, authenticator });
    registerStripeWebhookRoute(app, { service: appDeps.stripeService });
    registerBillingRoutes(app, { service: appDeps.stripeService, authenticator });
  }

  // WS gateway (§4) — verifies session JWTs with the same Env secret the token route signs with.
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
 * Construct the pipeline PROVIDERS for the loaded Env (ARCHITECTURE §5). MOCK_MODE=1 →
 * fixture-driven MockASRProvider + deterministic MockFormatter (keyless). Real mode →
 * DeepgramASRProvider + HaikuFormatter. Deliberately does NOT wire the Phase 3 hooks — those are
 * composed in `buildComposition`, so a bare provider pair (used by Phase 1 tests) stays hook-free.
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

// ── Composition adapters (bridge the usage/billing surfaces onto the auth-module ports) ───────────

/** Adapts a Redis {@link UsageCounter} + durable {@link UsageRepo} onto the auth {@link UsageReader}. */
class CounterUsageReader implements UsageReader {
  constructor(
    private readonly counter: UsageCounter,
    private readonly repo: UsageRepo,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async read(userId: string): Promise<{ wordsThisWeek: number }> {
    const weekStart = weekStartMondayUtc(this.now());
    const [redisWords, pgWords] = await Promise.all([
      this.counter.current(userId, weekStart),
      this.repo.getWeekTotal(userId, weekStart),
    ]);
    return { wordsThisWeek: Math.max(redisWords, pgWords) };
  }
}

/** Adapts the billing {@link SubscriptionRepo} onto the auth {@link SubscriptionReader} shape. */
class BillingSubscriptionReader implements SubscriptionReader {
  constructor(private readonly repo: SubscriptionRepo) {}

  async getByUserId(userId: string): Promise<SubscriptionRecord | undefined> {
    const row = await this.repo.getByUserId(userId);
    return row ? { status: row.status, currentPeriodEnd: row.currentPeriodEnd } : undefined;
  }
}

/** The fully-wired composition: gateway deps (providers + hooks), REST deps, and a cleanup fn. */
export interface Composition {
  gateway: GatewayDeps;
  appDeps: AppRouteDeps;
  /** Release external resources (Redis/DB pools) on shutdown. No-op in MOCK_MODE. */
  close: () => Promise<void>;
}

/**
 * Wire the whole backend for the loaded Env. MOCK_MODE=1 → in-memory everything, keyless, with the
 * `user_mock` (plan pro, active open-ended subscription so effective plan stays pro) seeded so
 * GET /v1/me works with no external state. Real mode → Clerk + Drizzle + Redis + Stripe.
 */
export async function buildComposition(env: Env): Promise<Composition> {
  const providers = buildGatewayDeps(env);

  if (env.mock) {
    // Identity — seed the fixed mock user + an active subscription (keeps effective plan = pro).
    const userStore = new InMemoryUserStore();
    userStore.seed({
      id: MOCK_USER_ID,
      clerkId: 'clerk_user_mock',
      email: 'mock@undertone.dev',
      plan: 'pro',
      trialEndsAt: null,
      stripeCustomerId: null,
      createdAt: new Date(),
    });
    const subscriptions = new InMemorySubscriptionReader();
    subscriptions.set(MOCK_USER_ID, { status: 'active', currentPeriodEnd: null });

    // Usage — one InMemoryRedis + FakeUsageRepo shared by the meter hook and the /v1/me reader.
    const redis = new InMemoryRedis();
    const usageCounter = new UsageCounter(redis);
    const usageRepo = new FakeUsageRepo();
    const usageReader = new CounterUsageReader(usageCounter, usageRepo);

    // Dictionary + history stores over in-memory repos.
    const dictionaryStore = new DictionaryStore(new InMemoryDictionaryRepo());
    const transcriptStore = createTranscriptStore(env, new InMemoryTranscriptRepo());

    // Billing — keyless FakeStripeClient + in-memory repos (mock user pre-seeded as pro).
    const stripeUserRepo = new InMemoryUserRepo([
      { id: MOCK_USER_ID, email: 'mock@undertone.dev', stripeCustomerId: null, plan: 'pro' },
    ]);
    const stripeService = new StripeService({
      stripeClient: createStripeClient(env),
      userRepo: stripeUserRepo,
      subscriptionRepo: new InMemorySubscriptionRepo(),
      priceConfig: resolvePriceConfig(),
      trialDays: TRIAL_DAYS,
    });

    const gateway: GatewayDeps = {
      ...providers,
      loadDictionary: (userId) => loadDictionaryForUser({ store: dictionaryStore }, userId),
      persistTranscript: (input) => persistTranscript({ store: transcriptStore }, input),
      meterUsage: (userId, wordCount, plan) =>
        meterUsage({ counter: usageCounter, repo: usageRepo }, userId, wordCount, plan),
    };

    return {
      gateway,
      appDeps: {
        authenticator: new MockAuthenticator(),
        userStore,
        subscriptions,
        usageReader,
        dictionaryStore,
        transcriptStore,
        stripeService,
      },
      close: () => Promise.resolve(),
    };
  }

  // ── Real mode ─────────────────────────────────────────────────────────────────────────────────
  const { db } = getDb(env);
  const { redis, close: closeRedis } = await createRedis(env.redisUrl);

  const userStore = new DrizzleUserStore(db);
  const billingSubscriptionRepo = new DrizzleSubscriptionRepo(db);
  const subscriptions = new BillingSubscriptionReader(billingSubscriptionRepo);

  const usageCounter = new UsageCounter(redis);
  const usageRepo = new DrizzleUsageRepo(db);
  const usageReader = new CounterUsageReader(usageCounter, usageRepo);

  const dictionaryStore = new DictionaryStore(new DrizzleDictionaryRepo(db));
  const transcriptStore = createTranscriptStore(env, new DrizzleTranscriptRepo(db));

  const stripeService = new StripeService({
    stripeClient: createStripeClient(env),
    userRepo: new DrizzleUserRepo(db),
    subscriptionRepo: billingSubscriptionRepo,
    priceConfig: resolvePriceConfig(),
    trialDays: TRIAL_DAYS,
  });

  const authenticator = new ClerkAuthenticator({
    verifier: new ClerkBackendVerifier({ secretKey: env.clerkSecretKey }),
    store: userStore,
    subscriptions,
  });

  const loadDictionary: LoadDictionaryHook = (userId) =>
    loadDictionaryForUser({ store: dictionaryStore }, userId);
  const persist: PersistHook = (input) => persistTranscript({ store: transcriptStore }, input);
  const meter: MeterHook = (userId, wordCount, plan) =>
    meterUsage({ counter: usageCounter, repo: usageRepo }, userId, wordCount, plan);

  const gateway: GatewayDeps = {
    ...providers,
    loadDictionary,
    persistTranscript: persist,
    meterUsage: meter,
  };

  return {
    gateway,
    appDeps: {
      authenticator,
      userStore,
      subscriptions,
      usageReader,
      dictionaryStore,
      transcriptStore,
      stripeService,
    },
    close: closeRedis,
  };
}

/** Load env, wire the composition, build the server, and start listening. Process entrypoint. */
export async function start(): Promise<FastifyInstance> {
  const env = loadEnv();
  const composition = await buildComposition(env);
  const app = buildServer(env, composition.gateway, composition.appDeps);
  app.addHook('onClose', () => composition.close());
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
