// Test double for the raw macOS addon (MacNativeBinding). Lets the mocked-seam unit tests drive
// the wrapper classes on any OS: fire hotkey transitions manually, script inject results, and
// inspect calls — no compiled .node required. Not shipped in the loader path.
import type { MacActiveApp, MacInjectStatus, MacNativeBinding } from './binding';
import type { PermissionStatus } from '../types';

export interface HotkeyRegistration {
  handle: number;
  keyCode: number;
  modifiers: number;
  cb: (phase: 'down' | 'up') => void;
  registered: boolean;
}

export class MockMacBinding implements MacNativeBinding {
  readonly registrations: HotkeyRegistration[] = [];
  readonly injectCalls: string[] = [];
  private nextHandle = 1;

  injectResult: MacInjectStatus | (() => MacInjectStatus) = 'ax';
  activeApp: MacActiveApp = { bundleId: 'com.apple.finder', appName: 'Finder', windowTitle: '' };
  permission: PermissionStatus = 'granted';

  hotkeyRegister(keyCode: number, modifiers: number, cb: (phase: 'down' | 'up') => void): number {
    const handle = this.nextHandle++;
    this.registrations.push({ handle, keyCode, modifiers, cb, registered: true });
    return handle;
  }

  hotkeyUnregister(handle: number): void {
    const reg = this.registrations.find((r) => r.handle === handle);
    if (reg) reg.registered = false;
  }

  /** Emit a raw transition for a handle, as the CGEventTap would. */
  fire(handle: number, phase: 'down' | 'up'): void {
    const reg = this.registrations.find((r) => r.handle === handle);
    if (!reg) throw new Error(`no registration for handle ${handle}`);
    reg.cb(phase);
  }

  inject(text: string): MacInjectStatus {
    this.injectCalls.push(text);
    return typeof this.injectResult === 'function' ? this.injectResult() : this.injectResult;
  }

  getActiveApp(): MacActiveApp {
    return this.activeApp;
  }

  checkPermission(): PermissionStatus {
    return this.permission;
  }
}
