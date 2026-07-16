// ActiveAppDetector (CONTRACTS.md §2.3) for darwin. NSWorkspace frontmostApplication →
// {bundleId, appName}; windowTitle via AX (kAXTitleAttribute of the focused window, '' when
// unavailable). This wrapper enforces the §1 domain rule: windowTitle truncated to 256 chars.
import type { AppContext } from '@undertone/shared';
import type { ActiveAppDetector } from '../types';
import type { MacNativeBinding } from './binding';

const MAX_WINDOW_TITLE = 256; // CONTRACTS.md §1 AppContext.windowTitle

export class DarwinActiveAppDetector implements ActiveAppDetector {
  constructor(private readonly binding: MacNativeBinding) {}

  async getActiveApp(): Promise<Omit<AppContext, 'register'>> {
    const raw = this.binding.getActiveApp();
    const windowTitle = (raw.windowTitle ?? '').slice(0, MAX_WINDOW_TITLE);
    return {
      bundleId: raw.bundleId,
      appName: raw.appName,
      windowTitle,
    };
  }
}
