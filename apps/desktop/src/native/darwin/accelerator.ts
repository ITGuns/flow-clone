// Accelerator parsing for the macOS hotkey path (CONTRACTS.md §2.3 `isSupported`).
//
// Grammar: `Mod+Mod+...+Key` — zero or more modifiers followed by exactly one non-modifier key,
// joined by '+'. Electron-style modifier aliases are accepted. The parse resolves to a macOS
// virtual key code (kVK_*) plus a modifier bitmask (see binding.ts). Pure and OS-independent so
// it is fully unit-testable on any host.
import { MOD_ALT, MOD_CMD, MOD_CTRL, MOD_SHIFT } from './binding';

export interface ParsedAccelerator {
  keyCode: number;
  modifiers: number; // bitmask of MOD_* from binding.ts
}

// Electron-style modifier tokens → bitmask bit. CommandOrControl resolves to Command on darwin.
const MODIFIER_ALIASES: Readonly<Record<string, number>> = {
  command: MOD_CMD,
  cmd: MOD_CMD,
  super: MOD_CMD,
  meta: MOD_CMD,
  commandorcontrol: MOD_CMD,
  cmdorctrl: MOD_CMD,
  control: MOD_CTRL,
  ctrl: MOD_CTRL,
  alt: MOD_ALT,
  option: MOD_ALT,
  opt: MOD_ALT,
  shift: MOD_SHIFT,
};

// Non-modifier key token → macOS virtual key code (Carbon kVK_* / HIToolbox Events.h).
// Covers the keys a push-to-talk binding realistically uses: letters, digits, F-keys, Space.
// Pure modifiers are intentionally excluded — a CGEventTap keyDown/keyUp never fires for them
// (they arrive as flagsChanged), so they are unsupported as the trigger key in v1.
const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0x00,
  s: 0x01,
  d: 0x02,
  f: 0x03,
  h: 0x04,
  g: 0x05,
  z: 0x06,
  x: 0x07,
  c: 0x08,
  v: 0x09,
  b: 0x0b,
  q: 0x0c,
  w: 0x0d,
  e: 0x0e,
  r: 0x0f,
  y: 0x10,
  t: 0x11,
  '1': 0x12,
  '2': 0x13,
  '3': 0x14,
  '4': 0x15,
  '6': 0x16,
  '5': 0x17,
  '9': 0x19,
  '7': 0x1a,
  '8': 0x1c,
  '0': 0x1d,
  o: 0x1f,
  u: 0x20,
  i: 0x22,
  p: 0x23,
  l: 0x25,
  j: 0x26,
  k: 0x28,
  n: 0x2d,
  m: 0x2e,
  space: 0x31,
  f1: 0x7a,
  f2: 0x78,
  f3: 0x63,
  f4: 0x76,
  f5: 0x60,
  f6: 0x61,
  f7: 0x62,
  f8: 0x64,
  f9: 0x65,
  f10: 0x6d,
  f11: 0x67,
  f12: 0x6f,
  f13: 0x69,
  f14: 0x6b,
  f15: 0x71,
  f16: 0x6a,
  f17: 0x40,
  f18: 0x4f,
  f19: 0x50,
  f20: 0x5a,
};

/**
 * Parse an accelerator. Returns null (never throws) on any malformed input so callers can use it
 * for both validation (`isSupported`) and resolution.
 */
export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  if (typeof accelerator !== 'string') return null;
  const raw = accelerator.trim();
  if (raw.length === 0) return null;

  const tokens = raw.split('+').map((t) => t.trim());
  if (tokens.some((t) => t.length === 0)) return null; // empty segment: leading/trailing/double '+'

  const keyToken = tokens[tokens.length - 1];
  const modifierTokens = tokens.slice(0, -1);
  if (keyToken === undefined) return null;

  let modifiers = 0;
  for (const token of modifierTokens) {
    const bit = MODIFIER_ALIASES[token.toLowerCase()];
    if (bit === undefined) return null; // unknown or non-modifier token in a modifier slot
    if ((modifiers & bit) !== 0) return null; // duplicate modifier
    modifiers |= bit;
  }

  const key = keyToken.toLowerCase();
  if (key in MODIFIER_ALIASES) return null; // trailing token must be a real key, not a modifier
  const keyCode = KEY_CODES[key];
  if (keyCode === undefined) return null;

  return { keyCode, modifiers };
}
