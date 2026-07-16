import { describe, it, expect } from 'vitest';
import { parseAccelerator } from './accelerator';
import { MOD_ALT, MOD_CMD, MOD_CTRL, MOD_SHIFT } from './binding';

describe('parseAccelerator', () => {
  it('parses a bare key with no modifiers', () => {
    expect(parseAccelerator('F13')).toEqual({ keyCode: 0x69, modifiers: 0 });
    expect(parseAccelerator('Space')).toEqual({ keyCode: 0x31, modifiers: 0 });
  });

  it('is case-insensitive on keys and modifiers', () => {
    expect(parseAccelerator('space')).toEqual({ keyCode: 0x31, modifiers: 0 });
    expect(parseAccelerator('d')).toEqual(parseAccelerator('D'));
  });

  it('parses a single modifier plus key', () => {
    expect(parseAccelerator('Control+Space')).toEqual({
      keyCode: 0x31,
      modifiers: MOD_CTRL,
    });
  });

  it('combines multiple modifiers into a bitmask', () => {
    const parsed = parseAccelerator('Command+Shift+D');
    expect(parsed).not.toBeNull();
    expect(parsed?.keyCode).toBe(0x02);
    expect(parsed?.modifiers).toBe(MOD_CMD | MOD_SHIFT);
  });

  it('maps every modifier alias family', () => {
    expect(parseAccelerator('Cmd+A')?.modifiers).toBe(MOD_CMD);
    expect(parseAccelerator('Super+A')?.modifiers).toBe(MOD_CMD);
    expect(parseAccelerator('Meta+A')?.modifiers).toBe(MOD_CMD);
    expect(parseAccelerator('CommandOrControl+A')?.modifiers).toBe(MOD_CMD);
    expect(parseAccelerator('CmdOrCtrl+A')?.modifiers).toBe(MOD_CMD);
    expect(parseAccelerator('Ctrl+A')?.modifiers).toBe(MOD_CTRL);
    expect(parseAccelerator('Option+A')?.modifiers).toBe(MOD_ALT);
    expect(parseAccelerator('Opt+A')?.modifiers).toBe(MOD_ALT);
    expect(parseAccelerator('Alt+A')?.modifiers).toBe(MOD_ALT);
    expect(parseAccelerator('Shift+A')?.modifiers).toBe(MOD_SHIFT);
  });

  it('trims surrounding and inter-token whitespace', () => {
    expect(parseAccelerator('  Command + Shift + D  ')).toEqual({
      keyCode: 0x02,
      modifiers: MOD_CMD | MOD_SHIFT,
    });
  });

  it('rejects an empty or whitespace-only string', () => {
    expect(parseAccelerator('')).toBeNull();
    expect(parseAccelerator('   ')).toBeNull();
  });

  it('rejects empty segments (leading, trailing, or doubled +)', () => {
    expect(parseAccelerator('+A')).toBeNull();
    expect(parseAccelerator('A+')).toBeNull();
    expect(parseAccelerator('Command++A')).toBeNull();
  });

  it('rejects an unknown key token', () => {
    expect(parseAccelerator('Command+£')).toBeNull();
    expect(parseAccelerator('Command+Enter')).toBeNull();
    expect(parseAccelerator('F21')).toBeNull();
  });

  it('rejects an unknown modifier token', () => {
    expect(parseAccelerator('Hyper+A')).toBeNull();
  });

  it('rejects a duplicate modifier', () => {
    expect(parseAccelerator('Command+Cmd+A')).toBeNull();
    expect(parseAccelerator('Shift+Shift+A')).toBeNull();
  });

  it('rejects a trailing modifier used as the key (pure-modifier accelerator)', () => {
    expect(parseAccelerator('Command')).toBeNull();
    expect(parseAccelerator('Control+Shift')).toBeNull();
  });
});
