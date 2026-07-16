// Auth module ports (Task 3a). These are the seams the Phase 3 gate wires to concrete impls:
// the real Clerk verifier + Drizzle-backed user store in real mode, and (for now) in-memory fakes
// or the future Redis/Postgres readers owned by other tasks (3e subscriptions, 3f usage).
//
// Keeping every external dependency behind a narrow port is what lets the ClerkAuthenticator,
// syncUser service and /v1/me route be unit-tested keyless — no live Clerk, Postgres or Redis.
import type { Plan } from '../routes/session-token';

export type { Plan };

/**
 * A `users` row (CONTRACTS §7) as this module consumes it — camelCased, with `Date` timestamps.
 * A strict subset/rename of the Drizzle `users.$inferSelect` shape so callers never depend on the
 * ORM row type directly.
 */
export interface UserRecord {
  id: string; // users.id (uuid) — the canonical app user id used as the token `sub`.
  clerkId: string;
  email: string;
  plan: Plan; // STORED plan; see effectivePlan() for the reported/effective plan.
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  createdAt: Date;
}

/** Fields required to create a brand-new user row (id/createdAt are assigned by the store). */
export interface NewUser {
  clerkId: string;
  email: string;
  plan: Plan;
  trialEndsAt: Date | null;
}

/**
 * Thin persistence port for the `users` table. The real impl (DrizzleUserStore) is backed by
 * Postgres; tests + mock mode use InMemoryUserStore.
 */
export interface UserStore {
  getById(id: string): Promise<UserRecord | undefined>;
  getByClerkId(clerkId: string): Promise<UserRecord | undefined>;
  /**
   * Insert a brand-new user. MUST be race-safe on `clerk_id`: if a row with the same clerk_id
   * already exists (concurrent first-auth), return that existing row instead of throwing or
   * duplicating. Trial/plan policy lives in {@link ./sync-user}, not here.
   */
  insert(user: NewUser): Promise<UserRecord>;
}

/** The verified identity a Clerk session token resolves to (identity + email). */
export interface ClerkPrincipal {
  clerkId: string; // Clerk user id (the token `sub`).
  email: string;
}

/** Verifies a Clerk-issued session token. Real impl: ClerkBackendVerifier; tests inject a fake. */
export interface ClerkVerifier {
  /** Resolve the principal for a valid token; reject for an invalid/expired one. Networkless in tests. */
  verify(token: string): Promise<ClerkPrincipal>;
}

/** A subscription row as effective-plan derivation needs it (owned by Task 3e's `subscriptions`). */
export interface SubscriptionRecord {
  status: string | null; // e.g. 'active' | 'canceled' | 'past_due' | null
  currentPeriodEnd: Date | null;
}

/** Reads the caller's current subscription. Gate wires Task 3e's reader; fake is in-memory. */
export interface SubscriptionReader {
  getByUserId(userId: string): Promise<SubscriptionRecord | undefined>;
}

/** A snapshot of the caller's rolling weekly usage (owned by Task 3f's Redis counters). */
export interface UsageSnapshot {
  wordsThisWeek: number;
}

/** Reads the caller's weekly word usage. Gate wires Task 3f's Redis reader; fake is in-memory. */
export interface UsageReader {
  read(userId: string): Promise<UsageSnapshot>;
}
