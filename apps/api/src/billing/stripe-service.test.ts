import { describe, it, expect } from 'vitest';
import { UndertoneError } from '@undertone/shared';
import { resolvePriceConfig, MOCK_PRICE_IDS } from './plans';
import { InMemorySubscriptionRepo, InMemoryUserRepo, type UserRecord } from './repos';
import { FakeStripeClient, type StripeEvent } from './stripe-client';
import { signStripePayload } from './stripe-signature';
import { StripeService } from './stripe-service';

const USER: UserRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dictator@example.com',
  stripeCustomerId: null,
  plan: 'free',
};
const CUSTOMER_ID = 'cus_test_1';
const WEBHOOK_SECRET = 'whsec_test';

function build(seed: UserRecord = USER): {
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

function subscriptionEvent(type: string, overrides: Record<string, unknown> = {}): StripeEvent {
  return {
    id: 'evt_sub',
    type,
    data: {
      object: {
        id: 'sub_test_1',
        customer: CUSTOMER_ID,
        status: 'active',
        current_period_end: 1_900_000_000,
        items: { data: [{ price: { recurring: { interval: 'month' } } }] },
        ...overrides,
      },
    },
  };
}

describe('StripeService.createCheckout', () => {
  it('creates a customer, persists stripe_customer_id, and opens a subscription session', async () => {
    const { service, userRepo, stripe } = build();

    const result = await service.createCheckout({
      userId: USER.id,
      interval: 'monthly',
      successUrl: 'https://ok',
      cancelUrl: 'https://no',
    });

    // stripe_customer_id was persisted on the user.
    const updated = await userRepo.getById(USER.id);
    expect(updated?.stripeCustomerId).toBe(result.customerId);
    expect(result.customerId).toBe('cus_fake_1');

    // Exactly one customer created, one checkout session with the monthly price + metadata.
    expect(stripe.createdCustomers).toHaveLength(1);
    expect(stripe.createdCustomers[0]).toMatchObject({ email: USER.email, userId: USER.id });
    expect(stripe.createdSessions).toHaveLength(1);
    expect(stripe.createdSessions[0]).toMatchObject({
      customerId: 'cus_fake_1',
      priceId: MOCK_PRICE_IDS.monthly,
      interval: 'monthly',
    });
    expect(result.url).toContain('https://checkout.stripe.test/');
  });

  it('reuses an existing stripe_customer_id (no new customer) and picks the yearly price', async () => {
    const { service, stripe } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });

    const result = await service.createCheckout({
      userId: USER.id,
      interval: 'yearly',
      successUrl: 'https://ok',
      cancelUrl: 'https://no',
    });

    expect(result.customerId).toBe(CUSTOMER_ID);
    expect(stripe.createdCustomers).toHaveLength(0);
    expect(stripe.createdSessions[0]).toMatchObject({
      customerId: CUSTOMER_ID,
      priceId: MOCK_PRICE_IDS.yearly,
      interval: 'yearly',
    });
  });

  it('throws when the user does not exist', async () => {
    const { service } = build();
    await expect(
      service.createCheckout({
        userId: 'missing',
        interval: 'monthly',
        successUrl: 'https://ok',
        cancelUrl: 'https://no',
      }),
    ).rejects.toBeInstanceOf(UndertoneError);
  });
});

describe('StripeService.handleWebhookEvent — subscription sync', () => {
  it('checkout.session.completed → subscription row + user.plan pro', async () => {
    const { service, userRepo, subRepo } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });

    await service.handleWebhookEvent({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: CUSTOMER_ID,
          subscription: 'sub_test_1',
          metadata: { userId: USER.id, interval: 'yearly' },
        },
      },
    });

    expect((await userRepo.getById(USER.id))?.plan).toBe('pro');
    expect(await subRepo.getByUserId(USER.id)).toMatchObject({
      stripeSubId: 'sub_test_1',
      status: 'active',
      planInterval: 'yearly',
    });
  });

  it('customer.subscription.updated (active) → upsert sub + plan pro with period end + interval', async () => {
    const { service, userRepo, subRepo } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });

    await service.handleWebhookEvent(subscriptionEvent('customer.subscription.updated'));

    expect((await userRepo.getById(USER.id))?.plan).toBe('pro');
    const row = await subRepo.getByUserId(USER.id);
    expect(row).toMatchObject({
      stripeSubId: 'sub_test_1',
      status: 'active',
      planInterval: 'monthly',
    });
    expect(row?.currentPeriodEnd).toEqual(new Date(1_900_000_000 * 1000));
  });

  it('customer.subscription.updated (canceled) → plan reverts to free', async () => {
    const { service, userRepo, subRepo } = build({
      ...USER,
      stripeCustomerId: CUSTOMER_ID,
      plan: 'pro',
    });

    await service.handleWebhookEvent(
      subscriptionEvent('customer.subscription.updated', { status: 'canceled' }),
    );

    expect((await userRepo.getById(USER.id))?.plan).toBe('free');
    expect((await subRepo.getByUserId(USER.id))?.status).toBe('canceled');
  });

  it('customer.subscription.deleted → plan free + subscription marked canceled', async () => {
    const { service, userRepo, subRepo } = build({
      ...USER,
      stripeCustomerId: CUSTOMER_ID,
      plan: 'pro',
    });

    await service.handleWebhookEvent(
      subscriptionEvent('customer.subscription.deleted', { status: undefined }),
    );

    expect((await userRepo.getById(USER.id))?.plan).toBe('free');
    expect((await subRepo.getByUserId(USER.id))?.status).toBe('canceled');
  });

  it('ignores an unknown event type (no writes)', async () => {
    const { service, userRepo, subRepo } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });

    await service.handleWebhookEvent({
      id: 'evt_x',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: CUSTOMER_ID } },
    });

    expect((await userRepo.getById(USER.id))?.plan).toBe('free');
    expect(await subRepo.getByUserId(USER.id)).toBeUndefined();
  });

  it('ignores events for an unknown customer (no throw, no writes)', async () => {
    const { service, subRepo } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });

    await service.handleWebhookEvent(
      subscriptionEvent('customer.subscription.updated', { customer: 'cus_stranger' }),
    );

    expect(await subRepo.getByUserId(USER.id)).toBeUndefined();
  });
});

describe('StripeService.handleSignedWebhook — signature gate', () => {
  it('verifies a valid signature then applies the event', async () => {
    const { service, userRepo } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });
    const body = JSON.stringify(subscriptionEvent('customer.subscription.updated'));
    const header = signStripePayload(body, WEBHOOK_SECRET);

    const result = await service.handleSignedWebhook(Buffer.from(body), header);

    expect(result).toEqual({ received: true });
    expect((await userRepo.getById(USER.id))?.plan).toBe('pro');
  });

  it('rejects a tampered body without applying anything', async () => {
    const { service, subRepo } = build({ ...USER, stripeCustomerId: CUSTOMER_ID });
    const body = JSON.stringify(subscriptionEvent('customer.subscription.updated'));
    const header = signStripePayload(body, WEBHOOK_SECRET);

    await expect(
      service.handleSignedWebhook(Buffer.from(`${body} `), header),
    ).rejects.toMatchObject({ name: 'StripeSignatureError' });
    expect(await subRepo.getByUserId(USER.id)).toBeUndefined();
  });
});
