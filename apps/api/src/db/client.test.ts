// Client-factory tests — the lazy-connection contract (CONTRACTS §5). No live Postgres: we assert
// that constructing a client does not dial a socket and that the mock-mode guard fires.
import { describe, it, expect, afterEach } from 'vitest';
import type { Env } from '../env';
import { createDbClient, getDb, resetDb } from './client';

/** A minimal real-mode-ish Env; only `databaseUrl` matters to the client factory. */
function envWith(databaseUrl: string): Env {
  return {
    mock: databaseUrl === '',
    databaseUrl,
    redisUrl: '',
    anthropicApiKey: '',
    deepgramApiKey: '',
    clerkSecretKey: '',
    clerkPublishableKey: '',
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    transcriptKey: '',
    tokenIndexKey: '',
    sessionJwtSecret: 'test',
    posthogHost: '',
  };
}

afterEach(async () => {
  await resetDb();
});

describe('createDbClient — laziness', () => {
  it('constructs a handle for an unreachable host without connecting or throwing', async () => {
    // Port 1 is unbound; postgres.js must not dial until a query runs, so this stays synchronous
    // and error-free. Immediately close the (never-opened) pool.
    const client = createDbClient('postgres://user:pass@127.0.0.1:1/undertone');
    expect(client.db).toBeDefined();
    expect(typeof client.sql).toBe('function');
    await client.close();
  });
});

describe('getDb — mock-mode guard & memoization', () => {
  it('throws a helpful error when DATABASE_URL is empty (mock mode)', () => {
    expect(() => getDb(envWith(''))).toThrow(/MOCK_MODE/);
  });

  it('returns the same memoized handle across calls', () => {
    const env = envWith('postgres://user:pass@127.0.0.1:1/undertone');
    const first = getDb(env);
    const second = getDb(env);
    expect(first).toBe(second);
  });
});
