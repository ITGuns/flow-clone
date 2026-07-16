// The raw N-API surface of the macOS addon (apps/desktop/native/mac). Kept deliberately minimal
// and "dumb": it performs OS calls and returns primitives / flat status strings. ALL policy —
// accelerator parsing, transition de-bounce, error mapping, truncation — lives in the wrapper
// classes above this seam and is unit-tested against a mock of this interface.
import { createRequire } from 'node:module';
import type { PermissionStatus } from '../types';
import { NativeUnavailableError } from '../errors';

/** Flat status returned by a single native inject attempt. Mapped to InjectResult in the wrapper. */
export type MacInjectStatus =
  | 'ax' // written directly into the focused AX element (kAXSelectedTextAttribute)
  | 'clipboard-fallback' // AX write rejected → saved clipboard, set text, synth Cmd+V, restore
  | 'no-permission' // AXIsProcessTrusted() is false
  | 'no-target' // no system-wide focused UI element
  | 'inject-failed'; // AX error and clipboard fallback also failed

export interface MacActiveApp {
  bundleId: string;
  appName: string;
  windowTitle: string; // may be '' when AX cannot read the focused window's title
}

/**
 * Modifier bitmask exchanged with the addon. Stable across the JS/native boundary; the addon
 * translates these bits to CGEventFlags. Mirror of the table in the wrapper's accelerator parser.
 */
export const MOD_CMD = 1 << 0;
export const MOD_CTRL = 1 << 1;
export const MOD_ALT = 1 << 2;
export const MOD_SHIFT = 1 << 3;

export interface MacNativeBinding {
  /**
   * Install a CGEventTap firing on down/up transitions of `keyCode` while `modifiers` (the mask
   * above) are satisfied. Returns an opaque handle for hotkeyUnregister. The addon may coalesce
   * OS-level key auto-repeat, but the wrapper de-bounces regardless.
   */
  hotkeyRegister(keyCode: number, modifiers: number, cb: (phase: 'down' | 'up') => void): number;
  hotkeyUnregister(handle: number): void;

  /** One synchronous injection attempt. Restore-after-paste is scheduled async by the addon. */
  inject(text: string): MacInjectStatus;

  getActiveApp(): MacActiveApp;

  /** AXIsProcessTrusted(). Read-only; never triggers the OS prompt (task 2d owns pre-prompt UX). */
  checkPermission(): PermissionStatus;
}

// Resolved relative to this compiled module. node-gyp emits to native/mac/build/Release.
const ADDON_RELATIVE_PATH = '../../../native/mac/build/Release/undertone_mac.node';

/**
 * Load the compiled addon. Throws NativeUnavailableError (never a raw MODULE_NOT_FOUND) when the
 * binary is absent — the expected case on non-darwin hosts and in the keyless mocked test run.
 */
export function loadMacBinding(): MacNativeBinding {
  try {
    const require = createRequire(import.meta.url);
    const addon = require(ADDON_RELATIVE_PATH) as MacNativeBinding;
    return addon;
  } catch (cause) {
    throw new NativeUnavailableError(
      'native module unavailable on this platform/build (macOS addon not compiled)',
      { cause },
    );
  }
}
