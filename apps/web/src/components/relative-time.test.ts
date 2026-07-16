import { describe, it, expect } from 'vitest';
import { formatRelative } from './relative-time';

const NOW = Date.parse('2026-07-15T12:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe('formatRelative', () => {
  it('reports recent times as "just now"', () => {
    expect(formatRelative(ago(10_000), NOW)).toBe('just now');
  });

  it('scales to minutes, hours, days, weeks', () => {
    expect(formatRelative(ago(5 * 60_000), NOW)).toBe('5m ago');
    expect(formatRelative(ago(3 * 3_600_000), NOW)).toBe('3h ago');
    expect(formatRelative(ago(2 * 86_400_000), NOW)).toBe('2d ago');
    expect(formatRelative(ago(14 * 86_400_000), NOW)).toBe('2w ago');
  });

  it('returns empty for an unparseable timestamp', () => {
    expect(formatRelative('not-a-date', NOW)).toBe('');
  });
});
