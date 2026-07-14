// Pure keyboard-event → accelerator-string logic for the hotkey recorder (task 4c). Kept out of the
// component so it unit-tests without a DOM: given the fields a `KeyboardEvent` exposes, produce an
// Electron-style accelerator (e.g. "F8", "Alt+Space", "Control+Shift+K") or `null` when the press is
// modifiers-only (the user is still mid-chord). Validation of whether the OS can actually bind the
// result is a separate concern, handled by the injected `HotkeyManager.isSupported` port.

/** The subset of `KeyboardEvent` the recorder reads. */
export interface KeyLikeEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS']);

/** Map a non-modifier `KeyboardEvent.key`/`.code` to an accelerator main-key token, or null. */
function mainKeyToken(evt: KeyLikeEvent): string | null {
  const { key, code } = evt;
  // Function keys: KeyboardEvent.key is already "F1".."F24".
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  // Space: key is " ".
  if (key === ' ' || code === 'Space') return 'Space';
  // Named editing/navigation keys whose accelerator token equals the DOM key name.
  const NAMED: Record<string, string> = {
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  if (NAMED[key] !== undefined) return NAMED[key];
  // Letters → uppercase single char.
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  // Digits (top row) via code "Digit0".."Digit9" so Shift+2 still records the digit, not "@".
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  // Bare digit key (no shift) as a fallback.
  if (/^[0-9]$/.test(key)) return key;
  return null;
}

/**
 * Build an accelerator string from a key event, or `null` if only modifiers are down (no main key
 * yet). Modifier order is fixed (Control, Alt, Shift, Super/Meta) so equal chords compare equal.
 */
export function acceleratorFromEvent(evt: KeyLikeEvent): string | null {
  if (MODIFIER_KEYS.has(evt.key)) return null; // modifiers-only press — keep waiting
  const main = mainKeyToken(evt);
  if (main === null) return null;
  const parts: string[] = [];
  if (evt.ctrlKey) parts.push('Control');
  if (evt.altKey) parts.push('Alt');
  if (evt.shiftKey) parts.push('Shift');
  if (evt.metaKey) parts.push('Super');
  parts.push(main);
  return parts.join('+');
}

/**
 * A soft conflict hint (not a hard error). A bare printable key with no modifier — a letter, digit,
 * Space, Enter, or Tab — will fire mid-typing in the target app, which is almost never what the user
 * wants for a global push-to-talk key. Returns advisory copy, or null when the choice looks fine.
 * Whether the OS can bind the accelerator at all is a separate check (`isSupported`).
 */
export function describeHotkeyConflict(accelerator: string): string | null {
  const parts = accelerator.split('+');
  const main = parts[parts.length - 1] ?? '';
  const hasModifier = parts.length > 1;
  if (hasModifier) return null;
  if (/^[A-Z0-9]$/.test(main) || main === 'Space' || main === 'Enter' || main === 'Tab') {
    return 'This key types characters in other apps — add a modifier (e.g. Alt) or pick a function key like F8.';
  }
  return null;
}
