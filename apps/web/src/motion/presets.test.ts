import { describe, it, expect } from 'vitest';
import { rise, listItem, word, tick } from './presets';

// The presets are presentation only. The contract that keeps behaviour intact is: when reduced is
// true, every preset yields `{ initial: false }` so motion mounts the element at its FINAL state
// with no enter/exit animation. When reduced is false, they add a small, non-bouncy transition.

const presets = { rise, listItem, word, tick };

describe('motion presets — reduced-motion disables animation cleanly', () => {
  it.each(Object.entries(presets))('%s returns { initial: false } when reduced', (_name, fn) => {
    expect(fn(true)).toEqual({ initial: false });
  });

  it.each(Object.entries(presets))('%s animates (no bounce) when not reduced', (_name, fn) => {
    const props = fn(false);
    expect(props.initial).not.toBe(false);
    expect(props.animate).toBeDefined();
    // No spring/bounce: transitions are plain tweens with a numeric duration.
    const transition = props.transition as { duration?: number; type?: string } | undefined;
    expect(transition?.duration).toBeTypeOf('number');
    expect(transition?.type).toBeUndefined();
  });

  it('listItem participates in layout animation only when not reduced', () => {
    expect((listItem(false) as { layout?: boolean }).layout).toBe(true);
    expect(listItem(true)).toEqual({ initial: false });
  });
});
