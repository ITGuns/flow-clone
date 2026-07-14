// TextInjector (CONTRACTS.md §2.3) for darwin. The addon performs the AX-primary write and, on
// AX rejection, the clipboard fallback (save → set → synth Cmd+V → restore after a short delay);
// this wrapper maps its flat status to the §2.3 InjectResult union and its §8 error codes, and
// guarantees the promise never rejects (a thrown native call becomes INJECT_FAILED).
import type { InjectResult, TextInjector } from '../types';
import type { MacInjectStatus, MacNativeBinding } from './binding';

const MESSAGES: Record<'no-permission' | 'no-target' | 'inject-failed', InjectResult> = {
  'no-permission': {
    ok: false,
    code: 'NO_PERMISSION',
    message: 'Accessibility permission is not granted; cannot inject text.',
  },
  'no-target': {
    ok: false,
    code: 'NO_TARGET',
    message: 'No focused UI element is available to receive text.',
  },
  'inject-failed': {
    ok: false,
    code: 'INJECT_FAILED',
    message: 'Text injection failed (AX write and clipboard fallback both failed).',
  },
};

export class DarwinTextInjector implements TextInjector {
  constructor(private readonly binding: MacNativeBinding) {}

  async inject(text: string): Promise<InjectResult> {
    // Nothing to insert — a no-op success that never touches the focused app or the clipboard.
    if (text.length === 0) return { ok: true, method: 'ax' };

    let status: MacInjectStatus;
    try {
      status = this.binding.inject(text);
    } catch (err) {
      return {
        ok: false,
        code: 'INJECT_FAILED',
        message: `Native injection threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    switch (status) {
      case 'ax':
        return { ok: true, method: 'ax' };
      case 'clipboard-fallback':
        return { ok: true, method: 'clipboard-fallback' };
      case 'no-permission':
      case 'no-target':
      case 'inject-failed':
        return MESSAGES[status];
      default:
        return {
          ok: false,
          code: 'INJECT_FAILED',
          message: `Unknown injection status from native layer: ${String(status)}`,
        };
    }
  }
}
