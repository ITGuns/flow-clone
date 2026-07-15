// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { prefersReducedMotion, initAnimations } from './anim';

function fakeWin(matchMedia: unknown): Window {
  return { matchMedia } as unknown as Window;
}

describe('prefersReducedMotion (the gate for every landing animation)', () => {
  it('fails safe to REDUCED when there is no window', () => {
    expect(prefersReducedMotion(undefined)).toBe(true);
  });

  it('fails safe to REDUCED when matchMedia is unavailable', () => {
    expect(prefersReducedMotion(fakeWin(undefined))).toBe(true);
  });

  it('is true when the user asked to reduce motion', () => {
    expect(prefersReducedMotion(fakeWin(() => ({ matches: true })))).toBe(true);
  });

  it('is false when the user has not asked to reduce motion', () => {
    expect(prefersReducedMotion(fakeWin(() => ({ matches: false })))).toBe(false);
  });

  it('fails safe to REDUCED if matchMedia throws', () => {
    expect(
      prefersReducedMotion(
        fakeWin(() => {
          throw new Error('blocked');
        }),
      ),
    ).toBe(true);
  });
});

describe('initAnimations wiring', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.innerHTML = '';
  });

  it('does not throw under reduced motion, and only the (non-motion) nav shadow is wired', () => {
    // jsdom has no matchMedia → prefersReducedMotion returns true → the motion pieces are skipped.
    document.body.innerHTML = '<header class="site-header"></header>';
    expect(() => initAnimations(window)).not.toThrow();
    const header = document.querySelector('.site-header');
    // At scrollY 0 the elevation class stays off; content is never hidden.
    expect(header?.classList.contains('is-scrolled')).toBe(false);
  });

  it('does not throw with animation enabled even when the marketing nodes are absent', () => {
    window.matchMedia = (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    document.body.innerHTML = '<header class="site-header"></header>';
    // Every animation helper guards on its own nodes, so an empty page is a clean no-op.
    expect(() => initAnimations(window)).not.toThrow();
  });
});
