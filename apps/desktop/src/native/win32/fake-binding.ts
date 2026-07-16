// Scripted fake of the win32 native seam — CONTRACTS.md §2.3.
//
// Lets the wrappers be unit-tested on any OS (guide §4.5): every OS effect the addon would
// have is replaced by inspectable in-memory state. Not shipped — imported only by *.test.ts.
import type {
  ClipboardPasteResult,
  ForegroundInfo,
  NativeActiveApp,
  SendUnicodeResult,
  Win32NativeBinding,
} from './binding';

export interface FakeBindingScript {
  foreground?: ForegroundInfo | null;
  sendUnicode?: (text: string) => SendUnicodeResult;
  clipboardPaste?: (text: string) => ClipboardPasteResult;
  activeApp?: NativeActiveApp;
}

interface RegisteredHotkey {
  vk: number;
  cb: (isDown: boolean) => void;
  active: boolean;
}

export class FakeBinding implements Win32NativeBinding {
  /** Every hotkey registration, in order, keyed by the handle the caller received. */
  readonly hotkeys = new Map<number, RegisteredHotkey>();
  /** Log of text passed to `sendUnicode`, for assertions. */
  readonly sentTexts: string[] = [];
  /** Log of text passed to `clipboardPaste`, for assertions. */
  readonly pastedTexts: string[] = [];

  private nextHandle = 1;

  constructor(private readonly script: FakeBindingScript = {}) {}

  hotkeyRegister(vk: number, cb: (isDown: boolean) => void): number {
    const handle = this.nextHandle++;
    this.hotkeys.set(handle, { vk, cb, active: true });
    return handle;
  }

  hotkeyUnregister(handle: number): void {
    const hk = this.hotkeys.get(handle);
    if (hk === undefined || !hk.active) {
      throw new Error(`hotkeyUnregister: unknown or already-released handle ${handle}`);
    }
    hk.active = false;
  }

  /** Test helper: simulate the low-level hook firing a transition for a live handle. */
  fire(handle: number, isDown: boolean): void {
    const hk = this.hotkeys.get(handle);
    if (hk === undefined || !hk.active) {
      throw new Error(`fire: handle ${handle} is not registered/active`);
    }
    hk.cb(isDown);
  }

  getForegroundWindow(): ForegroundInfo | null {
    return this.script.foreground === undefined ? defaultForeground() : this.script.foreground;
  }

  sendUnicode(text: string): SendUnicodeResult {
    this.sentTexts.push(text);
    if (this.script.sendUnicode) return this.script.sendUnicode(text);
    // Default: full success — every UTF-16 code unit → 2 events, all accepted.
    const events = text.length * 2;
    return { sent: events, accepted: events, lastError: 0 };
  }

  clipboardPaste(text: string): ClipboardPasteResult {
    this.pastedTexts.push(text);
    if (this.script.clipboardPaste) return this.script.clipboardPaste(text);
    return { ok: true, lastError: 0 };
  }

  getActiveApp(): NativeActiveApp {
    return (
      this.script.activeApp ?? {
        exeName: 'slack.exe',
        appName: 'Slack',
        title: 'general — Undertone workspace',
        pid: 4321,
      }
    );
  }
}

function defaultForeground(): ForegroundInfo {
  return { pid: 4321, isOwnProcess: false, className: 'Chrome_WidgetWin_1', title: 'Slack' };
}
