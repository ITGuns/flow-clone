// darwin entry point. `createNativeModule` is the convention the loader (../index.ts) calls by
// name after dynamically importing this directory; task 2b provides a win32/index.ts with the
// same export, so the loader needs no per-platform edits.
import type { NativeModule, PermissionStatus } from '../types';
import { loadMacBinding, type MacNativeBinding } from './binding';
import { DarwinHotkeyManager } from './hotkey-manager';
import { DarwinTextInjector } from './text-injector';
import { DarwinActiveAppDetector } from './active-app-detector';

export { DarwinHotkeyManager } from './hotkey-manager';
export { DarwinTextInjector } from './text-injector';
export { DarwinActiveAppDetector } from './active-app-detector';
export { parseAccelerator, type ParsedAccelerator } from './accelerator';
export type { MacNativeBinding, MacInjectStatus, MacActiveApp } from './binding';

/** Build the aggregate over an explicit binding — the seam unit tests construct against a mock. */
export function createNativeModuleFrom(binding: MacNativeBinding): NativeModule {
  const hotkeys = new DarwinHotkeyManager(binding);
  const injector = new DarwinTextInjector(binding);
  const detector = new DarwinActiveAppDetector(binding);
  return {
    hotkeys,
    injector,
    detector,
    checkPermission(): PermissionStatus {
      return binding.checkPermission();
    },
  };
}

/** Loader entry: resolves the real compiled addon (throws NativeUnavailableError if absent). */
export function createNativeModule(): NativeModule {
  return createNativeModuleFrom(loadMacBinding());
}
