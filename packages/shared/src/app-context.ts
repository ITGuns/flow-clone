// AppContext assembly — CONTRACTS.md §1 / §2.3. Turns the raw `ActiveAppDetector` output
// (`Omit<AppContext, "register">`) into a full `AppContext` by attaching the derived Register.
// Pure and OS-agnostic — the OS-specific detector produces the raw fields; this layer only
// classifies. Kept separate from register-map.ts so the mapping table and the assembly helper
// have independent test surfaces.

import type { AppContext } from './types';
import { deriveRegister } from './register-map';

/**
 * Max window-title length carried in an AppContext (CONTRACTS §1: "truncate to 256 chars").
 * Enforced here as defense in depth even though the native detector is expected to pre-truncate.
 */
export const WINDOW_TITLE_MAX = 256;

/** Trim surrounding whitespace, then hard-cap to WINDOW_TITLE_MAX characters. */
function normalizeWindowTitle(windowTitle: string): string {
  return (windowTitle ?? '').trim().slice(0, WINDOW_TITLE_MAX);
}

/**
 * Assemble a full AppContext from raw detector output: sanitize the window title (trim +
 * truncate to 256) and attach the register derived from the app identity. Total and pure —
 * never throws, resilient to empty/garbage fields (delegated to `deriveRegister`).
 */
export function buildAppContext(raw: Omit<AppContext, 'register'>): AppContext {
  const windowTitle = normalizeWindowTitle(raw.windowTitle);
  const register = deriveRegister(raw.bundleId, raw.appName, windowTitle);
  return {
    bundleId: raw.bundleId,
    appName: raw.appName,
    windowTitle,
    register,
  };
}
