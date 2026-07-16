import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { UndertoneError } from '@undertone/shared';
import { ClerkAuthenticator, extractBearerToken } from './clerk-authenticator';
import { InMemorySubscriptionReader, InMemoryUserStore } from './memory';
import type { ClerkPrincipal, ClerkVerifier } from './ports';

const NOW = new Date('2026-07-14T00:00:00.000Z');
const clock = (): Date => NOW;

/** Test double: verifies exactly one token string, rejects everything else. */
class FakeClerkVerifier implements ClerkVerifier {
  constructor(
    private readonly good: string,
    private readonly principal: ClerkPrincipal,
  ) {}
  verify(token: string): Promise<ClerkPrincipal> {
    if (token !== this.good) return Promise.reject(new Error('bad token'));
    return Promise.resolve(this.principal);
  }
}

function reqWithBearer(token: string | undefined): FastifyRequest {
  return {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  } as FastifyRequest;
}

function build(overrides?: {
  goodToken?: string;
  principal?: ClerkPrincipal;
  store?: InMemoryUserStore;
  subs?: InMemorySubscriptionReader;
}): {
  auth: ClerkAuthenticator;
  store: InMemoryUserStore;
  subs: InMemorySubscriptionReader;
} {
  const store = overrides?.store ?? new InMemoryUserStore(clock);
  const subs = overrides?.subs ?? new InMemorySubscriptionReader();
  const verifier = new FakeClerkVerifier(
    overrides?.goodToken ?? 'good-token',
    overrides?.principal ?? { clerkId: 'clerk_1', email: 'a@b.com' },
  );
  const auth = new ClerkAuthenticator({ verifier, store, subscriptions: subs, now: clock });
  return { auth, store, subs };
}

describe('extractBearerToken', () => {
  it('pulls the token out of an Authorization: Bearer header (case-insensitive)', () => {
    expect(extractBearerToken(reqWithBearer('abc'))).toBe('abc');
    expect(extractBearerToken({ headers: { authorization: 'bearer XYZ' } } as FastifyRequest)).toBe(
      'XYZ',
    );
  });

  it('returns undefined when the header is missing or malformed', () => {
    expect(extractBearerToken(reqWithBearer(undefined))).toBeUndefined();
    expect(
      extractBearerToken({ headers: { authorization: 'Basic abc' } } as FastifyRequest),
    ).toBeUndefined();
    expect(
      extractBearerToken({ headers: { authorization: 'Bearer   ' } } as FastifyRequest),
    ).toBeUndefined();
  });
});

describe('ClerkAuthenticator.authenticate', () => {
  it('ACCEPTS a valid token, syncs the user, and returns { userId, plan }', async () => {
    const { auth, store } = build();
    const authed = await auth.authenticate(reqWithBearer('good-token'));

    const synced = await store.getByClerkId('clerk_1');
    expect(synced).toBeDefined();
    expect(authed.userId).toBe(synced?.id);
    expect(authed.plan).toBe('pro'); // brand-new user is on the 14-day Pro trial
  });

  it('does not create a second row when the same user authenticates twice', async () => {
    const { auth, store } = build();
    const first = await auth.authenticate(reqWithBearer('good-token'));
    const second = await auth.authenticate(reqWithBearer('good-token'));
    expect(second.userId).toBe(first.userId);
    expect(await store.count()).toBe(1);
  });

  it('REJECTS an invalid token with UndertoneError(AUTH_INVALID)', async () => {
    const { auth } = build();
    await expect(auth.authenticate(reqWithBearer('wrong-token'))).rejects.toBeInstanceOf(
      UndertoneError,
    );
    await expect(auth.authenticate(reqWithBearer('wrong-token'))).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
  });

  it('REJECTS when no bearer token is present', async () => {
    const { auth } = build();
    await expect(auth.authenticate(reqWithBearer(undefined))).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
  });

  it('reports effective plan free when a returning pro user’s trial has expired (no sub)', async () => {
    const store = new InMemoryUserStore(clock);
    store.seed({
      id: 'u-expired',
      clerkId: 'clerk_exp',
      email: 'exp@user.com',
      plan: 'pro',
      trialEndsAt: new Date('2026-01-01T00:00:00.000Z'), // long past NOW
      stripeCustomerId: null,
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
    });
    const { auth } = build({
      goodToken: 'tok',
      principal: { clerkId: 'clerk_exp', email: 'exp@user.com' },
      store,
    });
    const authed = await auth.authenticate(reqWithBearer('tok'));
    expect(authed.userId).toBe('u-expired');
    expect(authed.plan).toBe('free');
  });

  it('keeps a trial-expired user on pro when they hold an active paid subscription', async () => {
    const store = new InMemoryUserStore(clock);
    store.seed({
      id: 'u-paid',
      clerkId: 'clerk_paid',
      email: 'paid@user.com',
      plan: 'pro',
      trialEndsAt: new Date('2026-01-01T00:00:00.000Z'),
      stripeCustomerId: 'cus_x',
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
    });
    const subs = new InMemorySubscriptionReader();
    subs.set('u-paid', {
      status: 'active',
      currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
    });
    const { auth } = build({
      goodToken: 'tok',
      principal: { clerkId: 'clerk_paid', email: 'paid@user.com' },
      store,
      subs,
    });
    const authed = await auth.authenticate(reqWithBearer('tok'));
    expect(authed.plan).toBe('pro');
  });
});
