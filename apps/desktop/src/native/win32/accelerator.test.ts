import { describe, expect, it } from 'vitest';
import { parseAccelerator } from './accelerator';

describe('parseAccelerator', () => {
  it('resolves function keys F1–F24', () => {
    expect(parseAccelerator('F1')).toEqual({ vk: 0x70, modifiers: [] });
    expect(parseAccelerator('F8')).toEqual({ vk: 0x77, modifiers: [] });
    expect(parseAccelerator('F24')).toEqual({ vk: 0x87, modifiers: [] });
  });

  it('rejects out-of-range function keys', () => {
    expect(parseAccelerator('F0')).toBeNull();
    expect(parseAccelerator('F25')).toBeNull();
  });

  it('resolves letters and digits to their VK (ASCII uppercase)', () => {
    expect(parseAccelerator('a')).toEqual({ vk: 0x41, modifiers: [] });
    expect(parseAccelerator('Z')).toEqual({ vk: 0x5a, modifiers: [] });
    expect(parseAccelerator('0')).toEqual({ vk: 0x30, modifiers: [] });
    expect(parseAccelerator('9')).toEqual({ vk: 0x39, modifiers: [] });
  });

  it('resolves named keys case-insensitively', () => {
    expect(parseAccelerator('Space')?.vk).toBe(0x20);
    expect(parseAccelerator('space')?.vk).toBe(0x20);
    expect(parseAccelerator('Escape')?.vk).toBe(0x1b);
    expect(parseAccelerator('RightControl')?.vk).toBe(0xa3);
  });

  it('parses modifiers but tracks the single main key', () => {
    expect(parseAccelerator('Alt+Space')).toEqual({ vk: 0x20, modifiers: ['alt'] });
    expect(parseAccelerator('CommandOrControl+Shift+K')).toEqual({
      vk: 0x4b,
      modifiers: ['commandorcontrol', 'shift'],
    });
  });

  it('is whitespace-tolerant around tokens', () => {
    expect(parseAccelerator(' Ctrl + Space ')).toEqual({ vk: 0x20, modifiers: ['ctrl'] });
  });

  it('returns null for empty, modifier-only, unknown, or multi-key accelerators', () => {
    expect(parseAccelerator('')).toBeNull();
    expect(parseAccelerator('   ')).toBeNull();
    expect(parseAccelerator('Ctrl+Alt')).toBeNull(); // modifiers only
    expect(parseAccelerator('Nonsense')).toBeNull();
    expect(parseAccelerator('A+B')).toBeNull(); // two main keys
  });
});
