// Typed env loader — CONTRACTS.md §10. Required vars are enforced ONLY when MOCK_MODE!=1;
// under MOCK_MODE=1 the whole external surface is stubbed, so missing keys are legal.

/** Env vars that must be present and non-empty in real mode (not mock). */
export const REQUIRED_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'ANTHROPIC_API_KEY',
  'DEEPGRAM_API_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TRANSCRIPT_KEY',
  'TOKEN_INDEX_KEY',
  'SESSION_JWT_SECRET',
] as const;

export interface Env {
  mock: boolean;
  databaseUrl: string;
  redisUrl: string;
  anthropicApiKey: string;
  deepgramApiKey: string;
  clerkSecretKey: string;
  clerkPublishableKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  transcriptKey: string;
  tokenIndexKey: string;
  sessionJwtSecret: string; // mock mode falls back to a fixed dev secret
  posthogHost: string; // '' = telemetry disabled
}

/** Thrown when required env vars are missing in real mode. `missing` lists them by name. */
export class EnvError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`Missing required environment variable(s): ${missing.join(', ')}`);
    this.name = 'EnvError';
    this.missing = missing;
  }
}

/**
 * Load and validate the environment. In mock mode, returns a fully-populated Env with empty
 * strings for any absent externals. In real mode, throws EnvError listing every missing var.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const mock = source.MOCK_MODE === '1';

  if (!mock) {
    const missing = REQUIRED_VARS.filter((key) => {
      const value = source[key];
      return value === undefined || value === '';
    });
    if (missing.length > 0) {
      throw new EnvError([...missing]);
    }
  }

  const read = (key: string): string => source[key] ?? '';

  return {
    mock,
    databaseUrl: read('DATABASE_URL'),
    redisUrl: read('REDIS_URL'),
    anthropicApiKey: read('ANTHROPIC_API_KEY'),
    deepgramApiKey: read('DEEPGRAM_API_KEY'),
    clerkSecretKey: read('CLERK_SECRET_KEY'),
    clerkPublishableKey: read('CLERK_PUBLISHABLE_KEY'),
    stripeSecretKey: read('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: read('STRIPE_WEBHOOK_SECRET'),
    transcriptKey: read('TRANSCRIPT_KEY'),
    tokenIndexKey: read('TOKEN_INDEX_KEY'),
    sessionJwtSecret: source.SESSION_JWT_SECRET ?? (mock ? 'mock-secret-do-not-ship' : ''),
    posthogHost: read('POSTHOG_HOST'),
  };
}
