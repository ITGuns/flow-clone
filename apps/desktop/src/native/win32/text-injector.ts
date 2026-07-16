// Win32 caret text injection — CONTRACTS.md §2.3 `TextInjector`, §8 error taxonomy.
//
// Strategy (guide §4.1 win row):
//   1. No foreground window, or it is our own HUD  → NO_TARGET (never inject into ourselves).
//   2. Primary: SendInput with KEYEVENTF_UNICODE   → handles arbitrary text incl. emoji /
//      surrogate pairs with no keyboard-layout dependence → { ok, method: 'sendinput' }.
//   3. UIPI case: a non-elevated process injecting into an elevated foreground app silently
//      fails — SendInput inserts fewer events than sent and GetLastError == ERROR_ACCESS_DENIED
//      → NO_PERMISSION (a synthesized Ctrl+V would be blocked the same way, so we do NOT fall
//      back). NO_PERMISSION is reserved for exactly this UIPI case (§2.3).
//   4. Other partial/rejected SendInput → clipboard fallback (save clipboard → set text →
//      synth Ctrl+V → restore) → { ok, method: 'clipboard-fallback' }; if that also fails,
//      INJECT_FAILED (client copies to clipboard + HUD "paste with Ctrl+V", §8).
import type { InjectResult, TextInjector } from '../types';
import { ERROR_ACCESS_DENIED, type Win32NativeBinding } from './binding';

export class Win32TextInjector implements TextInjector {
  constructor(private readonly binding: Win32NativeBinding) {}

  async inject(text: string): Promise<InjectResult> {
    // Empty text is a no-op success — nothing to place at the caret, no window needed.
    if (text.length === 0) {
      return { ok: true, method: 'sendinput' };
    }

    const fg = this.binding.getForegroundWindow();
    if (fg === null) {
      return { ok: false, code: 'NO_TARGET', message: 'No foreground window to inject into.' };
    }
    if (fg.isOwnProcess) {
      return {
        ok: false,
        code: 'NO_TARGET',
        message: 'Foreground window belongs to Undertone (HUD); refusing to inject into ourselves.',
      };
    }

    // Primary path: SendInput Unicode.
    const send = this.binding.sendUnicode(text);
    if (send.sent > 0 && send.accepted >= send.sent) {
      return { ok: true, method: 'sendinput' };
    }
    if (send.lastError === ERROR_ACCESS_DENIED) {
      return {
        ok: false,
        code: 'NO_PERMISSION',
        message:
          'The focused application is elevated; injection is blocked by Windows UIPI. ' +
          'Run Undertone as administrator to dictate into elevated apps.',
      };
    }

    // Secondary path: clipboard fallback.
    const paste = this.binding.clipboardPaste(text);
    if (paste.ok) {
      return { ok: true, method: 'clipboard-fallback' };
    }
    if (paste.lastError === ERROR_ACCESS_DENIED) {
      return {
        ok: false,
        code: 'NO_PERMISSION',
        message: 'The focused application is elevated; clipboard paste is blocked by Windows UIPI.',
      };
    }
    return {
      ok: false,
      code: 'INJECT_FAILED',
      message: `Injection failed (SendInput accepted ${send.accepted}/${send.sent}, clipboard fallback lastError ${paste.lastError}).`,
    };
  }
}
