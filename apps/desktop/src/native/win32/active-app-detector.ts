// Win32 active-app detection — CONTRACTS.md §2.3 `ActiveAppDetector`, §1 `AppContext`.
//
// Returns everything but `register` (derived client-side via register-map). On win32 the
// `bundleId` is the foreground process executable basename (e.g. "slack.exe"), matching the
// CONTRACTS §1 example. `windowTitle` is truncated to 256 chars per the contract.
import type { ActiveAppDetector } from '../types';
import type { AppContext } from '@undertone/shared';
import type { Win32NativeBinding } from './binding';

const TITLE_MAX = 256;

export class Win32ActiveAppDetector implements ActiveAppDetector {
  constructor(private readonly binding: Win32NativeBinding) {}

  async getActiveApp(): Promise<Omit<AppContext, 'register'>> {
    const raw = this.binding.getActiveApp();
    return {
      bundleId: raw.exeName,
      // Fall back to the executable name when no human-readable name is available.
      appName: raw.appName || raw.exeName,
      windowTitle: raw.title.length > TITLE_MAX ? raw.title.slice(0, TITLE_MAX) : raw.title,
    };
  }
}
