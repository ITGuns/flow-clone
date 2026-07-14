import { describe, it, expect } from 'vitest';
import {
  PLAN_LIMITS,
  TRIAL_DAYS,
  effectivePlan,
  hasActivePaidSubscription,
  planLimit,
} from './effective-plan';
import type { SubscriptionRecord, UserRecord } from './ports';

const NOW = new Date('2026-07-14T00:00:00.000Z');

function user(partial: Partial<UserRecord>): UserRecord {
  return {
    id: 'u-1',
    clerkId: 'clerk_1',
    email: 'a@b.com',
    plan: 'pro',
    trialEndsAt: null,
    stripeCustomerId: null,
    createdAt: NOW,
    ...partial,
  };
}

function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
}

describe('planLimit / PLAN_LIMITS (guide §1)', () => {
  it('free is 2000 words/week, pro is 50000', () => {
    expect(planLimit('free')).toBe(2000);
    expect(planLimit('pro')).toBe(50000);
    expect(PLAN_LIMITS).toEqual({ free: 2000, pro: 50000 });
  });

  it('exposes the 14-day trial length', () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('hasActivePaidSubscription', () => {
  it('false when there is no subscription', () => {
    expect(hasActivePaidSubscription(undefined, NOW)).toBe(false);
  });

  it('false when status is not active', () => {
    const sub: SubscriptionRecord = { status: 'canceled', currentPeriodEnd: daysFromNow(30) };
    expect(hasActivePaidSubscription(sub, NOW)).toBe(false);
  });

  it('false when the paid period has already ended', () => {
    const sub: SubscriptionRecord = { status: 'active', currentPeriodEnd: daysFromNow(-1) };
    expect(hasActivePaidSubscription(sub, NOW)).toBe(false);
  });

  it('true when active and the period is still open', () => {
    const sub: SubscriptionRecord = { status: 'active', currentPeriodEnd: daysFromNow(10) };
    expect(hasActivePaidSubscription(sub, NOW)).toBe(true);
  });

  it('true when active with an open-ended (null) period', () => {
    const sub: SubscriptionRecord = { status: 'active', currentPeriodEnd: null };
    expect(hasActivePaidSubscription(sub, NOW)).toBe(true);
  });
});

describe('effectivePlan (trial-expiry / subscription derivation)', () => {
  it("stored 'free' is always free", () => {
    expect(effectivePlan(user({ plan: 'free' }), undefined, NOW)).toBe('free');
  });

  it("stored 'pro' with an active trial reports pro", () => {
    expect(effectivePlan(user({ plan: 'pro', trialEndsAt: daysFromNow(3) }), undefined, NOW)).toBe(
      'pro',
    );
  });

  it("stored 'pro' but trial expired and NO active sub → effective free", () => {
    expect(effectivePlan(user({ plan: 'pro', trialEndsAt: daysFromNow(-1) }), undefined, NOW)).toBe(
      'free',
    );
  });

  it("stored 'pro', trial expired, but an active paid sub → pro", () => {
    const sub: SubscriptionRecord = { status: 'active', currentPeriodEnd: daysFromNow(20) };
    expect(effectivePlan(user({ plan: 'pro', trialEndsAt: daysFromNow(-5) }), sub, NOW)).toBe('pro');
  });

  it("stored 'pro', trial expired, sub present but expired → free", () => {
    const sub: SubscriptionRecord = { status: 'active', currentPeriodEnd: daysFromNow(-2) };
    expect(effectivePlan(user({ plan: 'pro', trialEndsAt: daysFromNow(-5) }), sub, NOW)).toBe(
      'free',
    );
  });

  it("stored 'pro' with a null trial and no sub → free", () => {
    expect(effectivePlan(user({ plan: 'pro', trialEndsAt: null }), undefined, NOW)).toBe('free');
  });

  it('trial boundary: exactly at trialEndsAt is still pro (>= now)', () => {
    expect(effectivePlan(user({ plan: 'pro', trialEndsAt: NOW }), undefined, NOW)).toBe('pro');
  });
});
