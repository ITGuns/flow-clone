// Drizzle client factory over the `postgres` (postgres.js) driver — ARCHITECTURE §Postgres.
//
// Laziness contract (CONTRACTS §5 mock mode): importing this module MUST NOT open a connection.
// postgres.js is lazy by construction — `postgres(url)` allocates a pool handle but dials no
// socket until the first query — and nothing here runs at import time. Under MOCK_MODE=1 the DB
// is simply never constructed (no route/service calls `getDb`), so the API boots keyless.
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import type { Env } from '../env';
import { schema } from './schema';

/** A live Drizzle handle plus the underlying driver, so callers can `close()` on shutdown. */
export interface DbClient {
  /** Drizzle query builder, typed against the full §7 schema (relational queries enabled). */
  readonly db: PostgresJsDatabase<typeof schema>;
  /** Raw postgres.js connection — exposed for `end()` and health checks only. */
  readonly sql: Sql;
  /** Close the pool. Idempotent; safe to call on process shutdown. */
  close(): Promise<void>;
}

/** Options forwarded to the postgres.js driver. Kept minimal; callers rarely need to override. */
export interface DbClientOptions {
  /** Max pool connections. Default 10 (single-region api; tune per Fly scale). */
  max?: number;
}

/**
 * Construct a Drizzle client for an explicit connection string. Does NOT connect until the first
 * query. Prefer {@link getDb} in application code (it memoizes from Env); use this directly in
 * scripts/tests that need an isolated pool.
 */
export function createDbClient(databaseUrl: string, options: DbClientOptions = {}): DbClient {
  const sql = postgres(databaseUrl, { max: options.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end(),
  };
}

let cached: DbClient | undefined;

/**
 * Process-wide memoized Drizzle client, built from `env.databaseUrl`. First call constructs the
 * pool (still no socket until a query runs); later calls return the same handle.
 *
 * Throws if called with an empty `databaseUrl` — that only happens in MOCK_MODE where no code
 * path should be reaching for Postgres. The message points at that misuse rather than surfacing
 * an opaque driver error on the first query.
 */
export function getDb(env: Env): DbClient {
  if (cached) return cached;
  if (env.databaseUrl === '') {
    throw new Error(
      'getDb called with an empty DATABASE_URL. Under MOCK_MODE=1 the database is not used — no code path should call getDb in mock mode.',
    );
  }
  cached = createDbClient(env.databaseUrl);
  return cached;
}

/** Reset the memoized client (tests / graceful shutdown). Closes the pool if one was opened. */
export async function resetDb(): Promise<void> {
  const existing = cached;
  cached = undefined;
  if (existing) await existing.close();
}
