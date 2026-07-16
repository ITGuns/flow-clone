// The win32 native seam — CONTRACTS.md §2.3 (win side of ARCHITECTURE.md §1).
//
// This interface is the ONLY surface the TypeScript wrappers touch. In production it is
// backed by the compiled N-API addon (`apps/desktop/native/win/`); in tests it is backed by
// a scripted fake (`fake-binding.ts`). Keeping every OS call behind this narrow, injectable
// boundary is what makes the wrappers unit-testable on any OS (guide §4.5) — the C++ is
// exercised only by the OS-matrix CI (`windows-latest`).
//
// The addon deliberately exposes small *primitives* (raw SendInput result, foreground-window
// facts, clipboard-paste result) rather than a finished `InjectResult`, so the fallback
// orchestration and §8 error-code mapping live in testable TS (`text-injector.ts`).

/** Foreground-window facts, captured atomically by the addon. `null` = no foreground window. */
export interface ForegroundInfo {
  /** PID owning the foreground window. */
  pid: number;
  /** True when that PID is our own Electron process tree (i.e. the HUD) → treat as NO_TARGET. */
  isOwnProcess: boolean;
  /** Win32 window class name (diagnostics only). */
  className: string;
  /** Window title, already truncated to 256 chars by the addon (diagnostics only). */
  title: string;
}

/** Result of a single `SendInput` KEYEVENTF_UNICODE burst. */
export interface SendUnicodeResult {
  /** Number of INPUT events we attempted to insert (2 per UTF-16 code unit: keydown+keyup). */
  sent: number;
  /** Number of events `SendInput` reported as inserted. `accepted < sent` ⇒ blocked/partial. */
  accepted: number;
  /** `GetLastError()` sampled when `accepted < sent`; 0 otherwise. 5 = ERROR_ACCESS_DENIED (UIPI). */
  lastError: number;
}

/** Result of the clipboard fallback (save → set → synth Ctrl+V → restore). */
export interface ClipboardPasteResult {
  ok: boolean;
  /** `GetLastError()` from the first failing step; 0 on success. */
  lastError: number;
}

/** Raw active-app facts for `ActiveAppDetector`. Empty strings when a field is unavailable. */
export interface NativeActiveApp {
  /** Foreground process executable basename, e.g. "slack.exe" → CONTRACTS §1 `bundleId`. */
  exeName: string;
  /** Best human-readable name (FileDescription from version info, else exe basename). */
  appName: string;
  /** Foreground window title (may be ""). */
  title: string;
  /** Owning PID. */
  pid: number;
}

/**
 * The compiled addon's exported surface. The hotkey callback is invoked from the addon's
 * thread-safe function (never from the low-level hook itself); `isDown` is `true` for a
 * key-down transition and `false` for key-up. Auto-repeat is de-duplicated in the addon, so
 * the callback fires once per physical press and once per release.
 */
export interface Win32NativeBinding {
  /** Install a WH_KEYBOARD_LL hook (dedicated thread + message loop) watching `vk`. */
  hotkeyRegister(vk: number, cb: (isDown: boolean) => void): number;
  /** Tear down the hook/thread/TSFN for `handle`. Safe to call once per handle. */
  hotkeyUnregister(handle: number): void;

  /** Snapshot the foreground window, or `null` if there is none. */
  getForegroundWindow(): ForegroundInfo | null;
  /** Inject `text` via SendInput KEYEVENTF_UNICODE (layout-independent, full BMP + surrogates). */
  sendUnicode(text: string): SendUnicodeResult;
  /** Clipboard fallback: preserve/restore prior clipboard around a synthesized Ctrl+V. */
  clipboardPaste(text: string): ClipboardPasteResult;

  /** Foreground app facts for context capture. */
  getActiveApp(): NativeActiveApp;
}

/** Win32 `GetLastError` codes we branch on. */
export const ERROR_ACCESS_DENIED = 5;

/**
 * Load the compiled addon. Isolated here so a missing build fails loudly at the seam (with an
 * actionable message) rather than as an opaque MODULE_NOT_FOUND deep in a wrapper. Only ever
 * called on win32 by `./index.ts`; other platforms never reach this.
 */
export function loadRealBinding(): Win32NativeBinding {
  if (process.platform !== 'win32') {
    throw new Error(`win32 native binding requested on non-win32 platform "${process.platform}"`);
  }
  // Lazy require via createRequire so ESM builds still resolve the CommonJS .node addon, and
  // so bundlers do not try to statically analyze the native artifact.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require('node:module') as typeof import('node:module');
  const req = createRequire(import.meta.url);
  try {
    // node-gyp-build resolves the correct prebuilt/compiled binary for this ABI + platform.
    return req('../../../native/win/index.js') as Win32NativeBinding;
  } catch (err) {
    throw new Error(
      'Failed to load the Undertone win32 native addon. Build it with ' +
        '`pnpm --filter @undertone/desktop build:native` (requires VS Build Tools + Python). ' +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}
