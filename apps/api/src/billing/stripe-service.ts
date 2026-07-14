// StripeService — CONTRACTS §5/§7/§8. Two responsibilities:
//   1. createCheckout: create/reuse a Stripe customer (persisting users.stripe_customer_id) and
//      open a subscription Checkout Session for the chosen Pro interval.
//   2. handleSignedWebhook → handleWebhookEvent: verify the signature, then sync subscription
//      state into Postgres — upsert `subscriptions` and set `users.plan` (active/trialing → 'pro',
//      canceled/expired → 'free'), keyed by mapping the Stripe customer to a user.
// All Stripe/DB access is behind injected ports, so this is exercised keyless in tests + MOCK_MODE.
import { UndertoneError } from '@undertone/shared';
import {
  type PlanInterval,
  planForStatus,
  planIntervalFromStripe,
  priceIdForInterval,
  type StripePriceConfig,
} from './plans';
import type { UserRepo, SubscriptionRepo } from './repos';
import type { StripeClient, StripeEvent } from './stripe-client';

/** Webhook event types this handler acts on; every other type is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export interface StripeServiceDeps {
  stripeClient: StripeClient;
  userRepo: UserRepo;
  subscriptionRepo: SubscriptionRepo;
  priceConfig: StripePriceConfig;
  /** Optional Stripe trial-days passed to Checkout (the §1 signup trial is applied at signup). */
  trialDays?: number;
}

export interface CreateCheckoutInput {
  userId: string;
  interval: PlanInterval;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutResult {
  url: string;
  customerId: string;
  sessionId: string;
}

// ── Defensive field extraction from the opaque event object (no `any`) ────────────────────────────

function str(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function record(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = obj[key];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** First `items.data[0]` entry of a Stripe subscription, if present. */
function firstItem(subscription: Record<string, unknown>): Record<string, unknown> | undefined {
  const items = record(subscription, 'items');
  const data = items?.data;
  if (!Array.isArray(data)) return undefined;
  const first: unknown = data[0];
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : undefined;
}

/** `current_period_end` (unix seconds) → Date, checking the top level then the first item. */
function extractPeriodEnd(subscription: Record<string, unknown>): Date | null {
  const top = subscription.current_period_end;
  if (typeof top === 'number') return new Date(top * 1000);
  const item = firstItem(subscription);
  const itemEnd = item?.current_period_end;
  if (typeof itemEnd === 'number') return new Date(itemEnd * 1000);
  return null;
}

/** Billing interval from `items.data[0].price.recurring.interval` → PlanInterval. */
function extractInterval(subscription: Record<string, unknown>): PlanInterval | null {
  const item = firstItem(subscription);
  if (!item) return null;
  const price = record(item, 'price');
  const recurring = price ? record(price, 'recurring') : undefined;
  const interval = recurring ? recurring.interval : undefined;
  if (typeof interval !== 'string') return null;
  return planIntervalFromStripe(interval) ?? null;
}

export class StripeService {
  constructor(private readonly deps: StripeServiceDeps) {}

  /** Create a subscription Checkout Session, persisting the user's Stripe customer id first. */
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const user = await this.deps.userRepo.getById(input.userId);
    if (!user) {
      throw new UndertoneError('INTERNAL', `no user ${input.userId} for checkout`);
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const created = await this.deps.stripeClient.createCustomer({
        email: user.email,
        userId: user.id,
      });
      customerId = created.id;
      await this.deps.userRepo.setStripeCustomerId(user.id, customerId);
    }

    const session = await this.deps.stripeClient.createCheckoutSession({
      customerId,
      priceId: priceIdForInterval(this.deps.priceConfig, input.interval),
      userId: user.id,
      interval: input.interval,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      trialDays: this.deps.trialDays,
    });
    if (session.url === null) {
      throw new UndertoneError('INTERNAL', 'stripe returned no checkout url');
    }
    return { url: session.url, customerId, sessionId: session.id };
  }

  /** Verify a raw signed delivery, then dispatch. Signature failure propagates (route → 400). */
  async handleSignedWebhook(rawBody: Buffer, signature: string): Promise<{ received: true }> {
    const event = this.deps.stripeClient.constructWebhookEvent(rawBody, signature);
    await this.handleWebhookEvent(event);
    return { received: true };
  }

  /** Dispatch a verified event onto the subscription-sync handlers. Unknown types are ignored. */
  async handleWebhookEvent(event: StripeEvent): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object);
        return;
      case 'customer.subscription.updated':
        await this.onSubscriptionChanged(event.data.object);
        return;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object);
        return;
      default:
        return; // acknowledged + ignored (§5 returns { received: true })
    }
  }

  private async onCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
    const customerId = str(session, 'customer');
    if (customerId === undefined) return;
    const user = await this.deps.userRepo.findByStripeCustomerId(customerId);
    if (!user) return;

    const metadata = record(session, 'metadata');
    const intervalMeta = metadata ? str(metadata, 'interval') : undefined;
    const planInterval =
      intervalMeta === 'monthly' || intervalMeta === 'yearly' ? intervalMeta : null;

    await this.deps.subscriptionRepo.upsert({
      userId: user.id,
      stripeSubId: str(session, 'subscription') ?? null,
      status: 'active',
      planInterval,
      currentPeriodEnd: null,
    });
    await this.deps.userRepo.setPlan(user.id, 'pro');
  }

  private async onSubscriptionChanged(subscription: Record<string, unknown>): Promise<void> {
    const customerId = str(subscription, 'customer');
    if (customerId === undefined) return;
    const user = await this.deps.userRepo.findByStripeCustomerId(customerId);
    if (!user) return;

    const status = str(subscription, 'status') ?? null;
    await this.deps.subscriptionRepo.upsert({
      userId: user.id,
      stripeSubId: str(subscription, 'id') ?? null,
      status,
      planInterval: extractInterval(subscription),
      currentPeriodEnd: extractPeriodEnd(subscription),
    });
    await this.deps.userRepo.setPlan(user.id, planForStatus(status ?? ''));
  }

  private async onSubscriptionDeleted(subscription: Record<string, unknown>): Promise<void> {
    const customerId = str(subscription, 'customer');
    if (customerId === undefined) return;
    const user = await this.deps.userRepo.findByStripeCustomerId(customerId);
    if (!user) return;

    await this.deps.subscriptionRepo.upsert({
      userId: user.id,
      stripeSubId: str(subscription, 'id') ?? null,
      status: str(subscription, 'status') ?? 'canceled',
      planInterval: extractInterval(subscription),
      currentPeriodEnd: extractPeriodEnd(subscription),
    });
    await this.deps.userRepo.setPlan(user.id, 'free');
  }
}
