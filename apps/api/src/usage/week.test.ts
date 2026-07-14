// Week-boundary tests — CONTRACTS §7 ("week starts Monday UTC"). Pure function, no I/O.
import { describe, it, expect } from 'vitest';
import { weekStartMondayUtc } from './week';

/** Build a UTC instant without local-timezone interference. */
function utc(iso: string): Date {
  return new Date(iso);
}

describe('weekStartMondayUtc', () => {
  it('maps a mid-week day back to that week’s Monday', () => {
    // 2026-07-14 is a Tuesday (matches the fixed "today" in this build).
    expect(weekStartMondayUtc(utc('2026-07-14T09:30:00.000Z'))).toBe('2026-07-13');
  });

  it('returns the same date when the day IS Monday', () => {
    expect(weekStartMondayUtc(utc('2026-07-13T00:00:00.000Z'))).toBe('2026-07-13');
  });

  it('treats Sunday as the LAST day of the Monday-started week (not the first)', () => {
    // Sunday 2026-07-19 belongs to the week beginning Monday 2026-07-13.
    expect(weekStartMondayUtc(utc('2026-07-19T23:59:59.999Z'))).toBe('2026-07-13');
  });

  it('rolls over to the next Monday at the Sunday→Monday UTC boundary', () => {
    const sundayLast = weekStartMondayUtc(utc('2026-07-19T23:59:59.999Z'));
    const mondayFirst = weekStartMondayUtc(utc('2026-07-20T00:00:00.000Z'));
    expect(sundayLast).toBe('2026-07-13');
    expect(mondayFirst).toBe('2026-07-20');
    expect(sundayLast).not.toBe(mondayFirst);
  });

  it('uses UTC, not local time — an instant is bucketed by its UTC calendar day', () => {
    // 2026-07-13T00:30:00Z is still Monday in UTC regardless of the host timezone.
    expect(weekStartMondayUtc(utc('2026-07-13T00:30:00.000Z'))).toBe('2026-07-13');
  });

  it('always yields a Monday for arbitrary inputs across a full week', () => {
    for (let day = 13; day <= 19; day++) {
      const d = utc(`2026-07-${day}T12:00:00.000Z`);
      const start = weekStartMondayUtc(d);
      // The returned date parsed at UTC midnight must be a Monday (getUTCDay === 1).
      expect(new Date(`${start}T00:00:00.000Z`).getUTCDay()).toBe(1);
      // And never in the future relative to the input.
      expect(new Date(`${start}T00:00:00.000Z`).getTime()).toBeLessThanOrEqual(d.getTime());
    }
  });
});
