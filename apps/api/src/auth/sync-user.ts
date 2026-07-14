// User-sync-on-auth service (Task 3a). Called by ClerkAuthenticator on every successful token
// verification; idempotent so it is safe to run on each request.
import { TRIAL_DAYS } from './effective-plan';
import type { ClerkPrincipal, UserRecord, UserStore } from './ports';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ensure a `users` row exists for a freshly-verified Clerk principal, returning it.
 *
 * NEW user → provisioned with the 14-day Pro trial (guide §1): `plan='pro'` and
 * `trial_ends_at = now + 14 days`, both computed HERE at insert time. (The schema's `plan`
 * column default of 'free' from Task 3b is the POST-trial fallback, never the signup state —
 * see effectivePlan().)
 *
 * RETURNING user → the existing row is returned unchanged (no fresh trial, no plan/email
 * mutation). The `clerk_id` uniqueness constraint plus the store's race-safe `insert` guarantee
 * exactly one row even under concurrent first-auths.
 */
export async function syncUser(
  store: UserStore,
  principal: ClerkPrincipal,
  now: () => Date = () => new Date(),
): Promise<UserRecord> {
  const existing = await store.getByClerkId(principal.clerkId);
  if (existing) return existing;

  const trialEndsAt = new Date(now().getTime() + TRIAL_DAYS * DAY_MS);
  return store.insert({
    clerkId: principal.clerkId,
    email: principal.email,
    plan: 'pro',
    trialEndsAt,
  });
}
