import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { UndertoneError } from '@undertone/shared';
import { InMemorySubscriptionReader, InMemoryUsageReader, InMemoryUserStore } from '../auth/memory';
import type { Plan, UserRecord } from '../auth/ports';
import type { Authenticator, AuthedUser } from './session-token';
import { registerMeRoute, type MeResponse } from './me';

const NOW = new Date('2026-07-14T00:00:00.000Z');
const clock = (): Date => NOW;

/** Stub authenticator that always resolves to a fixed principal (identity only). */
function stubAuth(user: AuthedUser): Authenticator {
  return { authenticate: () => Promise.resolve(user) };
}

const rejectingAuth: Authenticator = {
  authenticate: () => Promise.reject(new UndertoneError('AUTH_INVALID')),
};

function seededStore(partial: Partial<UserRecord> & { id: string; plan: Plan }): InMemoryUserStore {
  const store = new InMemoryUserStore(clock);
  store.seed({
    clerkId: `clerk_${partial.id}`,
    email: 'user@example.com',
    trialEndsAt: null,
    stripeCustomerId: null,
    createdAt: NOW,
    ...partial,
  });
  return store;
}

async function makeApp(deps: {
  authenticator: Authenticator;
  store: InMemoryUserStore;
  usage?: InMemoryUsageReader;
  subs?: InMemorySubscriptionReader;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerMeRoute(app, {
    authenticator: deps.authenticator,
    store: deps.store,
    usage: deps.usage ?? new InMemoryUsageReader(),
    subscriptions: deps.subs ?? new InMemorySubscriptionReader(),
    now: clock,
  });
  await app.ready();
  return app;
}

describe('GET /v1/me', () => {
  it('returns the §5 shape for a pro trial user', async () => {
    const usage = new InMemoryUsageReader();
    usage.set('u-1', 1234);
    const app = await makeApp({
      authenticator: stubAuth({ userId: 'u-1', plan: 'pro' }),
      store: seededStore({
        id: 'u-1',
        plan: 'pro',
        email: 'trial@user.com',
        trialEndsAt: new Date('2026-07-25T00:00:00.000Z'),
      }),
      usage,
    });

    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json<MeResponse>();
    expect(body).toEqual({
      userId: 'u-1',
      email: 'trial@user.com',
      plan: 'pro',
      trialEndsAt: '2026-07-25T00:00:00.000Z',
      usage: { wordsThisWeek: 1234, limit: 50000 },
    });
    expect(Object.keys(body).sort()).toEqual(['email', 'plan', 'trialEndsAt', 'usage', 'userId']);
    await app.close();
  });

  it('reports effective plan FREE (limit 2000) when a pro trial has expired and there is no sub', async () => {
    const app = await makeApp({
      authenticator: stubAuth({ userId: 'u-2', plan: 'pro' }),
      store: seededStore({
        id: 'u-2',
        plan: 'pro',
        trialEndsAt: new Date('2026-06-01T00:00:00.000Z'), // before NOW
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    const body = res.json<MeResponse>();
    expect(body.plan).toBe('free');
    expect(body.usage.limit).toBe(2000);
    // trialEndsAt is still reported honestly (a past date), not hidden.
    expect(body.trialEndsAt).toBe('2026-06-01T00:00:00.000Z');
    await app.close();
  });

  it('keeps effective pro (limit 50000) for an expired trial with an active paid subscription', async () => {
    const subs = new InMemorySubscriptionReader();
    subs.set('u-3', { status: 'active', currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z') });
    const app = await makeApp({
      authenticator: stubAuth({ userId: 'u-3', plan: 'pro' }),
      store: seededStore({
        id: 'u-3',
        plan: 'pro',
        trialEndsAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
      subs,
    });

    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    const body = res.json<MeResponse>();
    expect(body.plan).toBe('pro');
    expect(body.usage.limit).toBe(50000);
    await app.close();
  });

  it('surfaces usage counts from the injected UsageReader', async () => {
    const usage = new InMemoryUsageReader();
    usage.set('u-4', 42);
    const app = await makeApp({
      authenticator: stubAuth({ userId: 'u-4', plan: 'free' }),
      store: seededStore({ id: 'u-4', plan: 'free' }),
      usage,
    });
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.json<MeResponse>().usage).toEqual({ wordsThisWeek: 42, limit: 2000 });
    await app.close();
  });

  it('returns 401 with an AUTH_INVALID error frame when authentication fails', async () => {
    const app = await makeApp({
      authenticator: rejectingAuth,
      store: new InMemoryUserStore(clock),
    });
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('AUTH_INVALID');
    await app.close();
  });

  it('degrades gracefully (no 500) when the principal has no synced row', async () => {
    const usage = new InMemoryUsageReader();
    usage.set('ghost', 7);
    const app = await makeApp({
      authenticator: stubAuth({ userId: 'ghost', plan: 'pro' }),
      store: new InMemoryUserStore(clock), // empty
      usage,
    });
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(200);
    const body = res.json<MeResponse>();
    expect(body.userId).toBe('ghost');
    expect(body.plan).toBe('pro');
    expect(body.usage).toEqual({ wordsThisWeek: 7, limit: 50000 });
    await app.close();
  });
});
