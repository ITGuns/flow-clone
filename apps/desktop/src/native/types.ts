// Desktop native boundary — CONTRACTS.md §2.3, verbatim shapes.
//
// This is the platform-agnostic seam. Everything above it (config validation, accelerator
// parsing, event fan-out, error mapping) is unit-testable with mocks on any OS. Per-OS
// implementations (darwin here in task 2a; win32 in task 2b) live in sibling directories and
// satisfy `NativeModule`; the loader in ./index.ts platform-selects between them.
import type { AppContext } from '@undertone/shared';

export interface HotkeyManager {
  /** Register a global push-to-talk key. cb fires on transitions only. Returns unregister fn. */
  register(accelerator: string, cb: (phase: 'down' | 'up') => void): () => void;
  isSupported(accelerator: string): boolean;
}

export interface TextInjector {
  /** Insert text at the cursor of the frontmost app. Never steals or requires focus change. */
  inject(text: string): Promise<InjectResult>;
}

export type InjectResult =
  | { ok: true; method: 'ax' | 'sendinput' | 'uia' | 'clipboard-fallback' }
  | { ok: false; code: 'NO_PERMISSION' | 'NO_TARGET' | 'INJECT_FAILED'; message: string };

export interface ActiveAppDetector {
  getActiveApp(): Promise<Omit<AppContext, 'register'>>;
}

/**
 * Accessibility / input-monitoring permission state (guide §3, task 2d owns the pre-prompt UX).
 * The native layer only ever *reads* this (AXIsProcessTrusted); it never triggers the OS prompt.
 */
export type PermissionStatus = 'granted' | 'denied' | 'unknown';

/**
 * The aggregate a per-OS module exposes. The loader returns this; task 2b implements the same
 * shape for win32 without editing any darwin file.
 */
export interface NativeModule {
  readonly hotkeys: HotkeyManager;
  readonly injector: TextInjector;
  readonly detector: ActiveAppDetector;
  /** AXIsProcessTrusted (mac) / equivalent (win). Read-only — never prompts. */
  checkPermission(): PermissionStatus;
}
