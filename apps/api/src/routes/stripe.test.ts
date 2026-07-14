import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { UndertoneError } from '@undertone/shared';
import {
  FakeStripeClient,
  InMemorySubscriptionRepo,
  InMemoryUserRepo,
  MOCK_PRICE_IDS,
  StripeService,
  resolvePriceConfig,
  signStripePayload,
  type StripeEvent,
  type UserRecord,
} from '../billing';
import { MockAuthenticator, type Authenticator } from './session-token';
import { registerBillingRoutes, registerStripeWebhookRoute } from './stripe';

const WEBHOOK_SECRET = 'whsec_route_test';
const CUSTOMER_ID = 'cus_route_1';
const USER: UserRecord = {
  id: 'user_mock',
  email: 'route@example.com',
  stripeCustomerId: CUSTOMER_ID,
  plan: 'free',
};

function makeService(seed: UserRecord = USER): {
  service: StripeService;
  userRepo: InMemoryUserRepo;
  subRepo: InMemorySubscriptionRepo;
  stripe: FakeStripeClient;
} {
  const userRepo = new InMemoryUserRepo([seed]);
  const subRepo = new InMemorySubscriptionRepo();
  const stripe = new FakeStripeClient(WEBHOOK_SECRET);
  const service = new StripeService({
    stripeClient: stripe,
    userRepo,
    subscriptionRepo: subRepo,
    priceConfig: resolvePriceConfig({}),
  });
  return { service, userRepo, subRepo, stripe };
}

function subUpdatedBody(status = 'active'): string {
  const event: StripeEvent = {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_1',
        customer: CUSTOMER_ID,
        status,
        current_period_end: 1_900_000_000,
        items: { data: [{ price: { recurring: { interval: 'month' } } }] },
      },
    },
  };
  return JSON.stringify(event);
}

describe('POST /v1/webhooks/stripe (§5)', () => {
  it('200 { received: true } on a valid signature, and syncs the subscription', async () => {
    const { service, userRepo, subRepo } = makeService();
    const app = Fastify({ logger: false });
    registerStripeWebhookRoute(app, { service });
    await app.ready();

    const body = subUpdatedBody('active');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(body, WEBHOOK_SECRET),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect((await userRepo.getById(USER.id))?.plan).toBe('pro');
    expect((await subRepo.getByUserId(USER.id))?.stripeSubId).toBe('sub_1');
    await app.close();
  });

  it('400 on a bad signature (no auth), applying nothing', async () => {
    const { service, subRepo } = makeService();
    const app = Fastify({ logger: false });
    registerStripeWebhookRoute(app, { service });
    await app.ready();

    const body = subUpdatedBody('active');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(body, 'whsec_wrong'),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(await subRepo.getByUserId(USER.id)).toBeUndefined();
    await app.close();
  });

  it('400 when the stripe-signature header is missing', async () => {
    const { service } = makeService();
    const app = Fastify({ logger: false });
    registerStripeWebhookRoute(app, { service });
    await app.ready();

    const body = subUpdatedBody('active');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('200 and ignores an unknown event type', async () => {
    const { service, userRepo } = makeService();
    const app = Fastify({ logger: false });
    registerStripeWebhookRoute(app, { service });
    await app.ready();

    const body = JSON.stringify({
      id: 'evt_x',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: CUSTOMER_ID } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(body, WEBHOOK_SECRET),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect((await userRepo.getById(USER.id))?.plan).toBe('free');
    await app.close();
  });

  it('does not break JSON body parsing on sibling routes (parser is encapsulated)', async () => {
    const { service } = makeService();
    const app = Fastify({ logger: false });
    registerStripeWebhookRoute(app, { service });
    // A sibling route on the parent instance must still receive a PARSED JSON body.
    app.post('/echo', (req: FastifyRequest) => req.body as unknown);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ hello: 'world' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hello: 'world' });
    await app.close();
  });
});

describe('POST /v1/billing/checkout (additive — not in §5)', () => {
  let app: FastifyInstance;

  async function boot(deps: { service: StripeService; authenticator: Authenticator }): Promise<void> {
    app = Fastify({ logger: false });
    registerBillingRoutes(app, deps);
    await app.ready();
  }

  it('200 { url } and persists stripe_customer_id for the authed user', async () => {
    const seed: UserRecord = { ...USER, stripeCustomerId: null };
    const { service, userRepo, stripe } = makeService(seed);
    await boot({ service, authenticator: new MockAuthenticator({ userId: 'user_mock', plan: 'free' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: { interval: 'monthly' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ url: string }>().url).toContain('https://checkout.stripe.test/');
    expect((await userRepo.getById('user_mock'))?.stripeCustomerId).toBe('cus_fake_1');
    expect(stripe.createdSessions[0]).toMatchObject({ priceId: MOCK_PRICE_IDS.monthly });
    await app.close();
  });

  it('400 on a missing/invalid interval', async () => {
    const { service } = makeService();
    await boot({ service, authenticator: new MockAuthenticator({ userId: 'user_mock', plan: 'free' }) });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: { interval: 'weekly' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('401 when the authenticator rejects', async () => {
    const { service } = makeService();
    const rejecting: Authenticator = {
      authenticate: (_req: FastifyRequest) => Promise.reject(new UndertoneError('AUTH_INVALID')),
    };
    await boot({ service, authenticator: rejecting });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: { interval: 'monthly' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
