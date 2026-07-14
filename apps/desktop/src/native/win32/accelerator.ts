// Accelerator string → Windows virtual-key code — CONTRACTS.md §2.3 (`HotkeyManager`).
//
// Push-to-talk needs a single *tracked* key whose down/up transitions the low-level hook
// reports. We accept Electron-style accelerator strings ("F8", "Space", "Alt+Space",
// "CommandOrControl+Shift+K", "RightControl") and resolve the one non-modifier key to its VK.
// Modifier tokens are parsed and validated but not gated on in v1 — the hook fires on the main
// key's transitions regardless of modifier state (documented limitation; see hotkey-manager).
//
// VK constants: https://learn.microsoft.com/windows/win32/inputdev/virtual-key-codes

const MODIFIERS = new Set([
  'ctrl',
  'control',
  'cmd',
  'command',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta',
]);

/** Fixed named keys → VK. Left/right modifier *keys* used standalone as PTT are here too. */
const NAMED: Record<string, number> = {
  space: 0x20,
  spacebar: 0x20,
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  esc: 0x1b,
  escape: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  capslock: 0x14,
  // Standalone modifier keys used as a dedicated PTT trigger.
  rightcontrol: 0xa3,
  rightctrl: 0xa3,
  leftcontrol: 0xa2,
  leftctrl: 0xa2,
  rightshift: 0xa1,
  leftshift: 0xa0,
  rightalt: 0xa5,
  leftalt: 0xa4,
};

/** F1–F24 → 0x70–0x87. */
function functionKeyVk(token: string): number | undefined {
  const m = /^f(\d{1,2})$/.exec(token);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 1 || n > 24) return undefined;
  return 0x70 + (n - 1);
}

/** Resolve a single (non-modifier) key token to its VK, or undefined if unknown. */
function keyTokenToVk(token: string): number | undefined {
  const t = token.toLowerCase();
  if (NAMED[t] !== undefined) return NAMED[t];
  const fk = functionKeyVk(t);
  if (fk !== undefined) return fk;
  // A–Z and 0–9 map to their ASCII uppercase codepoint (VK_A == 'A', VK_0 == '0').
  if (/^[a-z0-9]$/.test(t)) return t.toUpperCase().charCodeAt(0);
  return undefined;
}

export interface ParsedAccelerator {
  /** The tracked virtual-key code whose transitions drive push-to-talk. */
  vk: number;
  /** Lower-cased modifier tokens present in the accelerator (parsed, not gated in v1). */
  modifiers: string[];
}

/**
 * Parse an accelerator into its tracked VK + modifiers. Returns `null` when there is no
 * resolvable main key (e.g. modifiers only, empty, or an unknown token) — callers surface this
 * as `isSupported === false`.
 */
export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  if (typeof accelerator !== 'string' || accelerator.trim() === '') return null;
  const tokens = accelerator
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) return null;

  const modifiers: string[] = [];
  const mainKeys: number[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (MODIFIERS.has(lower)) {
      modifiers.push(lower);
      continue;
    }
    const vk = keyTokenToVk(token);
    if (vk === undefined) return null; // unknown token → unsupported
    mainKeys.push(vk);
  }
  // Exactly one non-modifier key is required (v1 tracks a single VK).
  if (mainKeys.length !== 1) return null;
  return { vk: mainKeys[0]!, modifiers };
}
