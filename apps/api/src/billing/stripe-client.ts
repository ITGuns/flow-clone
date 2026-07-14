// StripeClient port — the injectable seam between billing logic and the Stripe SDK / network.
// Business logic (StripeService, the webhook route) depends ONLY on this interface and the narrow
// `StripeEvent` domain shape, never on the SDK's concrete types. Two impls:
//   RealStripeClient — wraps the `stripe` SDK for live API calls; verifies webhook sigs via our
//                      own helper (identical scheme to the SDK, single tested code path).
//   FakeStripeClient — no network, no keys: signs/verifies with the same helper and mints
//                      deterministic ids. Used under MOCK_MODE=1 and in every unit test.
import Stripe from 'stripe';
import type { Env } from '../env';
import type { PlanInterval } from './plans';
import { StripeSignatureError, verifyStripeSignature } from './stripe-signature';

/** Mock-mode webhook secret — used when env.stripeWebhookSecret is empty (keyless build/CI). */
export const MOCK_WEBHOOK_SECRET = 'whsec_mock_do_not_ship';

/**
 * The narrow slice of a Stripe event our handler needs — mirrors the SDK's `{ id, type, data:
 * { object } }` shape but keeps `object` as an opaque record so the handler extracts fields
 * defensively and stays decoupled from SDK versioning.
 */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface CreateCustomerParams {
  email: string;
  userId: string;
}

export interface CreateCheckoutSessionParams {
  customerId: string;
  priceId: string;
  userId: string;
  interval: PlanInterval;
  successUrl: string;
  cancelUrl: string;
  /** Optional Stripe trial length in days for the created subscription. */
  trialDays?: number;
}

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
}

/** The injectable Stripe boundary. */
export interface StripeClient {
  /** Verify + parse a signed webhook delivery. Throws {@link StripeSignatureError} on bad sig. */
  constructWebhookEvent(rawBody: Buffer, signature: string): StripeEvent;
  createCustomer(params: CreateCustomerParams): Promise<{ id: string }>;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult>;
}

/** Coerce a parsed JSON value into the narrow {@link StripeEvent} shape. */
function coerceEvent(value: unknown): StripeEvent {
  if (typeof value !== 'object' || value === null) {
    throw new StripeSignatureError('webhook body is not a JSON object');
  }
  const root = value as Record<string, unknown>;
  const type = root.type;
  if (typeof type !== 'string') throw new StripeSignatureError('webhook event missing "type"');
  const data = root.data;
  const rawObject =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>).object : undefined;
  return {
    id: typeof root.id === 'string' ? root.id : '',
    type,
    data: {
      object:
        typeof rawObject === 'object' && rawObject !== null
          ? (rawObject as Record<string, unknown>)
          : {},
    },
  };
}

/** Real Stripe client — wraps the SDK for live calls, verifies webhooks via our own helper. */
export class RealStripeClient implements StripeClient {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  constructWebhookEvent(rawBody: Buffer, signature: string): StripeEvent {
    // Signature verification uses the same helper the FakeStripeClient uses, so the check under
    // test is the one that runs in prod. (The SDK's constructEvent implements the same scheme.)
    verifyStripeSignature(rawBody, signature, this.webhookSecret);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new StripeSignatureError('webhook body is not valid JSON');
    }
    return coerceEvent(parsed);
  }

  async createCustomer(params: CreateCustomerParams): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      metadata: { userId: params.userId },
    });
    return { id: customer.id };
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: { userId: params.userId, interval: params.interval },
    };
    if (params.trialDays !== undefined) subscriptionData.trial_period_days = params.trialDays;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { userId: params.userId, interval: params.interval },
      subscription_data: subscriptionData,
    });
    return { id: session.id, url: session.url };
  }
}

/** Deterministic keyless Stripe stub for MOCK_MODE=1 and unit tests. */
export class FakeStripeClient implements StripeClient {
  /** Every createCustomer call's params, in order (test inspection). */
  readonly createdCustomers: CreateCustomerParams[] = [];
  /** Every createCheckoutSession call's params, in order (test inspection). */
  readonly createdSessions: CreateCheckoutSessionParams[] = [];
  private customerSeq = 0;
  private sessionSeq = 0;

  constructor(
    private readonly webhookSecret: string = MOCK_WEBHOOK_SECRET,
    private readonly verifyOpts: { toleranceSec?: number } = {},
  ) {}

  constructWebhookEvent(rawBody: Buffer, signature: string): StripeEvent {
    verifyStripeSignature(rawBody, signature, this.webhookSecret, {
      toleranceSec: this.verifyOpts.toleranceSec,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new StripeSignatureError('webhook body is not valid JSON');
    }
    return coerceEvent(parsed);
  }

  createCustomer(params: CreateCustomerParams): Promise<{ id: string }> {
    this.createdCustomers.push(params);
    this.customerSeq += 1;
    return Promise.resolve({ id: `cus_fake_${this.customerSeq}` });
  }

  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    this.createdSessions.push(params);
    this.sessionSeq += 1;
    return Promise.resolve({
      id: `cs_fake_${this.sessionSeq}`,
      url: `https://checkout.stripe.test/session/${this.sessionSeq}`,
    });
  }
}

/**
 * Construct the Env-selected StripeClient. MOCK_MODE=1 → keyless FakeStripeClient (webhook secret
 * falls back to {@link MOCK_WEBHOOK_SECRET}). Real mode → RealStripeClient over a live SDK. The
 * composition root wires this at the Phase 3 gate; billing code always depends on the port.
 */
export function createStripeClient(env: Env): StripeClient {
  if (env.mock) {
    return new FakeStripeClient(env.stripeWebhookSecret || MOCK_WEBHOOK_SECRET);
  }
  return new RealStripeClient(new Stripe(env.stripeSecretKey), env.stripeWebhookSecret);
}
