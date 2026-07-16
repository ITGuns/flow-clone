import { describe, it, expect } from 'vitest';
import { relativeTime, absoluteTime } from '../history';

const NOW = new Date('2026-07-15T12:00:00.000Z');
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime — buckets', () => {
  it('recent → "just now"', () => {
    expect(relativeTime(ago(5 * SEC), NOW)).toBe('just now');
    expect(relativeTime(ago(44 * SEC), NOW)).toBe('just now');
  });
  it('minutes', () => {
    expect(relativeTime(ago(3 * MIN), NOW)).toBe('3 min ago');
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59 min ago');
  });
  it('hours', () => {
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe('2 hr ago');
  });
  it('yesterday then days', () => {
    expect(relativeTime(ago(30 * HOUR), NOW)).toBe('yesterday');
    expect(relativeTime(ago(3 * DAY), NOW)).toBe('3 days ago');
  });
  it('older than a week → an absolute date (not a relative phrase)', () => {
    const label = relativeTime(ago(30 * DAY), NOW);
    expect(label).not.toContain('ago');
    expect(label.length).toBeGreaterThan(0);
  });
  it('future timestamps clamp to "just now"', () => {
    expect(relativeTime(new Date(NOW.getTime() + 10 * MIN).toISOString(), NOW)).toBe('just now');
  });
  it('an invalid ISO string returns empty', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
    expect(absoluteTime('not-a-date')).toBe('');
  });
});
