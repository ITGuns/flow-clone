// GET /v1/me — CONTRACTS §5. Returns the caller's identity, effective plan, trial end, and weekly
// usage. Clerk bearer auth (Phase 3) is abstracted behind the frozen `Authenticator` interface so
// this route is testable keyless; the effective-plan derivation and usage/subscription reads go
// through the auth-module ports (Task 3f wires the real Redis UsageReader, Task 3e the real
// SubscriptionReader at the Phase 3 gate).
//
// Exposed as a `registerMeRoute(app, deps)` plugin so the composition root (index.ts) can wire it
// without this module reaching for process.env or a concrete store.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UndertoneError, toErrorMessage } from '@undertone/shared';
import { effectivePlan, planLimit } from '../auth/effective-plan';
import type { SubscriptionReader, UsageReader, UserStore } from '../auth/ports';
import type { Authenticator, Plan } from './session-token';

/** The `GET /v1/me` 200 body (CONTRACTS §5). */
export interface MeResponse {
  userId: string;
  email: string;
  plan: Plan;
  trialEndsAt: string | null;
  usage: { wordsThisWeek: number; limit: number };
}

/** Injected collaborators for the /v1/me route. */
export interface MeRouteDeps {
  authenticator: Authenticator;
  store: UserStore;
  usage: UsageReader;
  subscriptions: SubscriptionReader;
  /** Clock for trial/subscription evaluation; defaults to `() => new Date()`. Injected in tests. */
  now?: () => Date;
}

/** Register `GET /v1/me`. 200 → {@link MeResponse}; 401 error frame on auth failure (§5). */
export function registerMeRoute(app: FastifyInstance, deps: MeRouteDeps): void {
  const clock = deps.now ?? ((): Date => new Date());

  app.get(
    '/v1/me',
    async (req: FastifyRequest, reply: FastifyReply): Promise<MeResponse | void> => {
      let userId: string;
      let principalPlan: Plan;
      try {
        const authed = await deps.authenticator.authenticate(req);
        userId = authed.userId;
        principalPlan = authed.plan;
      } catch (err) {
        const wire =
          err instanceof UndertoneError
            ? toErrorMessage(err)
            : {
                t: 'error' as const,
                code: 'AUTH_INVALID' as const,
                message: 'unauthenticated',
                retryable: false,
              };
        void reply.status(401).send(wire);
        return;
      }

      const now = clock();
      const usage = await deps.usage.read(userId);
      const user = await deps.store.getById(userId);

      if (!user) {
        // Degraded path: an authenticated principal with no synced `users` row (e.g. a
        // non-syncing authenticator wired against an unseeded store). Report what the principal
        // carries rather than 500ing — the shape's keys stay present.
        return {
          userId,
          email: '',
          plan: principalPlan,
          trialEndsAt: null,
          usage: { wordsThisWeek: usage.wordsThisWeek, limit: planLimit(principalPlan) },
        };
      }

      // Report the plan honestly: a stored 'pro' whose trial lapsed with no active paid sub is
      // downgraded to effective 'free' here (§5). `trialEndsAt` is still surfaced verbatim.
      const sub = await deps.subscriptions.getByUserId(user.id);
      const plan = effectivePlan(user, sub, now);
      return {
        userId: user.id,
        email: user.email,
        plan,
        trialEndsAt: user.trialEndsAt ? user.trialEndsAt.toISOString() : null,
        usage: { wordsThisWeek: usage.wordsThisWeek, limit: planLimit(plan) },
      };
    },
  );
}
