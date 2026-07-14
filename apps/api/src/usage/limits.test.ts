// Limit-table tests — CONTRACTS §7 / BUILD_GUIDE §1 caps.
import { describe, it, expect } from 'vitest';
import { WEEKLY_WORD_LIMITS, weeklyWordLimit } from './limits';

describe('weekly word limits', () => {
  it('pins the free tier to 2000 words/week (§1)', () => {
    expect(weeklyWordLimit('free')).toBe(2000);
    expect(WEEKLY_WORD_LIMITS.free).toBe(2000);
  });

  it('pins the pro fair-use cap to 50000 words/week (§1)', () => {
    expect(weeklyWordLimit('pro')).toBe(50000);
    expect(WEEKLY_WORD_LIMITS.pro).toBe(50000);
  });

  it('selects the limit strictly by the plan passed in', () => {
    expect(weeklyWordLimit('pro')).toBeGreaterThan(weeklyWordLimit('free'));
  });
});
