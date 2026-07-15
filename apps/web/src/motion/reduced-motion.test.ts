import { describe, it, expect } from 'vitest';
import { resolveReducedMotion } from './reduced-motion';

// A minimal Window stand-in whose matchMedia we control. The resolver only touches `matchMedia`.
function win(matchMedia: unknown): Window {
  return { matchMedia } as unknown as Window;
}

describe('resolveReducedMotion (the gate every dashboard animation asks first)', () => {
  it('defaults to REDUCED when there is no window (SSR / non-browser)', () => {
    expect(resolveReducedMotion(undefined)).toBe(true);
  });

  it('defaults to REDUCED when matchMedia is unavailable (e.g. jsdom)', () => {
    expect(resolveReducedMotion(win(undefined))).toBe(true);
  });

  it('returns true when the user prefers reduced motion', () => {
    expect(resolveReducedMotion(win(() => ({ matches: true })))).toBe(true);
  });

  it('returns false when the user has NOT asked to reduce motion', () => {
    expect(resolveReducedMotion(win(() => ({ matches: false })))).toBe(false);
  });

  it('fails safe to REDUCED if matchMedia throws', () => {
    expect(
      resolveReducedMotion(
        win(() => {
          throw new Error('blocked');
        }),
      ),
    ).toBe(true);
  });
});
