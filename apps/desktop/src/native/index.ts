// Platform-selecting loader for the desktop native module (CONTRACTS.md §2.3).
//
// The seam is convention-based so task 2b adds win32 WITHOUT editing this file: a platform's
// directory (./darwin, ./win32) exports `createNativeModule(): NativeModule`, and this loader
// dynamically imports `./<platform>/index` and calls it. A missing/uncompiled addon surfaces as
// NativeUnavailableError, never a raw module-resolution throw — the wrapper "loads lazily and
// gracefully when the binary is missing".
import type { NativeModule } from './types';
import { NativeUnavailableError } from './errors';

export type { HotkeyManager, TextInjector, ActiveAppDetector, InjectResult } from './types';
export type { NativeModule, PermissionStatus } from './types';
export { NativeUnavailableError } from './errors';

const SUPPORTED: ReadonlySet<string> = new Set(['darwin', 'win32']);

/** A platform module import — injectable so the selection logic is testable without a real addon. */
export type PlatformImport = () => Promise<unknown>;

function defaultImport(platform: string): Promise<unknown> {
  // Computed specifier: keeps this file free of a static ./win32 reference (which would fail
  // typecheck until 2b lands) while still resolving each real directory at runtime.
  return import(/* @vite-ignore */ `./${platform}/index.js`);
}

/**
 * Resolve the native module for `platform` (defaults to the host). `importPlatform` is injected in
 * tests. Rejects with NativeUnavailableError on an unsupported OS, a failed import (addon absent),
 * or a module missing the `createNativeModule` export.
 */
export async function loadNativeModule(
  platform: NodeJS.Platform = process.platform,
  importPlatform: PlatformImport = () => defaultImport(platform),
): Promise<NativeModule> {
  if (!SUPPORTED.has(platform)) {
    throw new NativeUnavailableError(
      `native module unavailable on this platform/build (unsupported platform: ${platform})`,
    );
  }

  let mod: unknown;
  try {
    mod = await importPlatform();
  } catch (cause) {
    throw new NativeUnavailableError(
      `native module unavailable on this platform/build (${platform})`,
      { cause },
    );
  }

  const factory = (mod as { createNativeModule?: unknown }).createNativeModule;
  if (typeof factory !== 'function') {
    throw new NativeUnavailableError(
      `native module unavailable on this platform/build (${platform} module missing createNativeModule)`,
    );
  }
  return (factory as () => NativeModule)();
}
