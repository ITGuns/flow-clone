// ClerkAuthenticator — the real, Clerk-backed implementation of the frozen `Authenticator`
// interface (apps/api/src/routes/session-token.ts, created by Task 1c). It conforms EXACTLY to
// that interface: `authenticate(req) => Promise<AuthedUser>` returning the same `{ userId, plan }`
// principal shape MockAuthenticator returns.
//
// Responsibilities on each successful verification:
//   1. verify the Clerk session token (via the injected ClerkVerifier — networkless in tests),
//   2. sync-on-auth: ensure a `users` row exists (new → 14-day Pro trial), and
//   3. return { userId = users.id, plan = effective plan } for the token/quota layer.
//
// The composition root keeps using MockAuthenticator under MOCK_MODE=1; the Phase 3 gate swaps
// this in for real mode at the same seam.
import type { FastifyRequest } from 'fastify';
import { UndertoneError } from '@undertone/shared';
import type { AuthedUser, Authenticator } from '../routes/session-token';
import { effectivePlan } from './effective-plan';
import { syncUser } from './sync-user';
import type { ClerkPrincipal, ClerkVerifier, SubscriptionReader, UserStore } from './ports';

/** Injected collaborators for {@link ClerkAuthenticator}. */
export interface ClerkAuthenticatorDeps {
  verifier: ClerkVerifier;
  store: UserStore;
  subscriptions: SubscriptionReader;
  /** Clock for trial/subscription evaluation; defaults to `() => new Date()`. Injected in tests. */
  now?: () => Date;
}

export class ClerkAuthenticator implements Authenticator {
  private readonly verifier: ClerkVerifier;
  private readonly store: UserStore;
  private readonly subscriptions: SubscriptionReader;
  private readonly now: () => Date;

  constructor(deps: ClerkAuthenticatorDeps) {
    this.verifier = deps.verifier;
    this.store = deps.store;
    this.subscriptions = deps.subscriptions;
    this.now = deps.now ?? ((): Date => new Date());
  }

  async authenticate(req: FastifyRequest): Promise<AuthedUser> {
    const token = extractBearerToken(req);
    if (token === undefined) {
      throw new UndertoneError('AUTH_INVALID', 'missing Clerk bearer token');
    }

    let principal: ClerkPrincipal;
    try {
      principal = await this.verifier.verify(token);
    } catch (err) {
      throw new UndertoneError('AUTH_INVALID', 'invalid Clerk session token', { cause: err });
    }

    // Sync-on-auth: guarantees a `users` row exists (new signup → 14-day Pro trial) before the
    // principal is handed to the token/quota layer.
    const user = await syncUser(this.store, principal, this.now);
    const sub = await this.subscriptions.getByUserId(user.id);
    const plan = effectivePlan(user, sub, this.now());
    return { userId: user.id, plan };
  }
}

/**
 * Extract the bearer token from `Authorization: Bearer <token>` (scheme match is
 * case-insensitive). Returns undefined when the header is absent, uses another scheme, or carries
 * an empty token.
 */
export function extractBearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}
