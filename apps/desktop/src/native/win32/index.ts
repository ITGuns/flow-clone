// win32 native platform assembly — CONTRACTS.md §2.3.
//
// Wires the three §2.3 seams over a single `Win32NativeBinding`. `createWin32Platform` takes an
// optional binding so tests can inject a fake; production omits it and the real compiled addon
// is loaded lazily. Kept separate from `../index.ts` so the darwin loader (task 2a) merges
// additively at the platform-dispatch layer without touching win32 internals.
import type {
  ActiveAppDetector,
  HotkeyManager,
  NativeModule,
  PermissionStatus,
  TextInjector,
} from '../types';
import { loadRealBinding, type Win32NativeBinding } from './binding';
import { Win32HotkeyManager } from './hotkey-manager';
import { Win32TextInjector } from './text-injector';
import { Win32ActiveAppDetector } from './active-app-detector';

export interface Win32Platform {
  hotkeys: HotkeyManager;
  injector: TextInjector;
  activeApp: ActiveAppDetector;
}

export function createWin32Platform(binding: Win32NativeBinding = loadRealBinding()): Win32Platform {
  return {
    hotkeys: new Win32HotkeyManager(binding),
    injector: new Win32TextInjector(binding),
    activeApp: new Win32ActiveAppDetector(binding),
  };
}

/**
 * Loader entry (../index.ts calls this by name after importing this directory) — the same
 * `createNativeModule(): NativeModule` convention the darwin module exposes, so the platform
 * loader needs no per-OS branch. Windows requires no accessibility grant for SendInput / the
 * low-level hook, so `checkPermission` is always `granted` (microphone is handled separately by
 * the permission flow, task 2d).
 */
export function createNativeModuleFrom(binding: Win32NativeBinding): NativeModule {
  const platform = createWin32Platform(binding);
  return {
    hotkeys: platform.hotkeys,
    injector: platform.injector,
    detector: platform.activeApp,
    checkPermission(): PermissionStatus {
      return 'granted';
    },
  };
}

export function createNativeModule(): NativeModule {
  return createNativeModuleFrom(loadRealBinding());
}

export { Win32HotkeyManager } from './hotkey-manager';
export { Win32TextInjector } from './text-injector';
export { Win32ActiveAppDetector } from './active-app-detector';
export type { Win32NativeBinding } from './binding';
