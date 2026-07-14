import { describe, it, expect } from 'vitest';
import {
  MOCK_PRICE_IDS,
  PLANS,
  PRO_SUBSCRIPTION_STATUSES,
  TRIAL_DAYS,
  WEEKLY_WORD_LIMITS,
  planForStatus,
  planIntervalFromStripe,
  priceIdForInterval,
  resolvePriceConfig,
  weeklyWordLimit,
} from './plans';

describe('plan definitions (guide §1)', () => {
  it('encodes the §1 weekly word limits', () => {
    expect(WEEKLY_WORD_LIMITS).toEqual({ free: 2000, pro: 50000 });
    expect(weeklyWordLimit('free')).toBe(2000);
    expect(weeklyWordLimit('pro')).toBe(50000);
  });

  it('encodes the §1 pricing and trial', () => {
    expect(PLANS.free.monthlyPriceUsd).toBe(0);
    expect(PLANS.pro.monthlyPriceUsd).toBe(12);
    expect(PLANS.pro.yearlyPriceUsd).toBe(96);
    expect(PLANS.pro.weeklyWordLimit).toBe(50000);
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('resolvePriceConfig', () => {
  it('falls back to mock placeholders when env is unset', () => {
    expect(resolvePriceConfig({})).toEqual(MOCK_PRICE_IDS);
  });

  it('reads STRIPE_PRICE_PRO_* env vars when present', () => {
    const cfg = resolvePriceConfig({
      STRIPE_PRICE_PRO_MONTHLY: 'price_live_m',
      STRIPE_PRICE_PRO_YEARLY: 'price_live_y',
    });
    expect(cfg).toEqual({ monthly: 'price_live_m', yearly: 'price_live_y' });
    expect(priceIdForInterval(cfg, 'monthly')).toBe('price_live_m');
    expect(priceIdForInterval(cfg, 'yearly')).toBe('price_live_y');
  });
});

describe('subscription status → plan mapping', () => {
  it('grants pro for active/trialing, free otherwise', () => {
    for (const status of PRO_SUBSCRIPTION_STATUSES) {
      expect(planForStatus(status)).toBe('pro');
    }
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'past_due', '']) {
      expect(planForStatus(status)).toBe('free');
    }
  });
});

describe('planIntervalFromStripe', () => {
  it('maps month/year and rejects the unknown', () => {
    expect(planIntervalFromStripe('month')).toBe('monthly');
    expect(planIntervalFromStripe('year')).toBe('yearly');
    expect(planIntervalFromStripe('week')).toBeUndefined();
  });
});
