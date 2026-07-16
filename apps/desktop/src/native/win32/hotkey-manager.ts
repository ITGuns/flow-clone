// Win32 global push-to-talk hotkey — CONTRACTS.md §2.3 `HotkeyManager`, §3 re-entrancy rule.
//
// RegisterHotKey cannot deliver key-UP, and push-to-talk needs both transitions, so the addon
// uses a WH_KEYBOARD_LL hook on a dedicated thread with its own message loop. This wrapper owns
// the accelerator→VK resolution, the down/up phase mapping, and the transitions-only guarantee
// the contract promises callers; the thread/hook/TSFN lifetime lives in the addon behind
// `Win32NativeBinding`.
//
// Re-entrancy / auto-repeat guard (PURE, so it is unit-tested on any OS): §2.3 promises "cb
// fires on transitions only" and §3 requires a held key to emit exactly one down and one up.
// A WH_KEYBOARD_LL hook delivers a stream of WM_KEYDOWN messages while a key is physically held
// (OS key auto-repeat), and could deliver a spurious repeat around focus changes. The addon
// de-duplicates at the hook, but we ALSO enforce strict down/up alternation here so the
// guarantee holds regardless of the native layer: a `down` while already pressed is dropped, and
// an `up` while already released is dropped. This is exactly the §3 "key-down during a non-idle
// state is ignored (no re-entrancy in v1)" rule at the input seam — a second press mid-utterance
// never reaches the session state machine as a fresh `down`.
import type { HotkeyManager } from '../types';
import type { Win32NativeBinding } from './binding';
import { parseAccelerator } from './accelerator';

export class Win32HotkeyManager implements HotkeyManager {
  constructor(private readonly binding: Win32NativeBinding) {}

  register(accelerator: string, cb: (phase: 'down' | 'up') => void): () => void {
    const parsed = parseAccelerator(accelerator);
    if (parsed === null) {
      throw new Error(`Unsupported accelerator: "${accelerator}"`);
    }
    // Per-registration press state — the transitions-only / re-entrancy guard.
    let pressed = false;
    const handle = this.binding.hotkeyRegister(parsed.vk, (isDown: boolean) => {
      if (isDown) {
        if (pressed) return; // auto-repeat / re-entrant down → ignored (§3)
        pressed = true;
        cb('down');
      } else {
        if (!pressed) return; // stray up with no matching down → ignored
        pressed = false;
        cb('up');
      }
    });

    // Unregister is idempotent: guard so a double-call (e.g. React effect cleanup racing app
    // shutdown) never double-frees the native hook.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.binding.hotkeyUnregister(handle);
    };
  }

  isSupported(accelerator: string): boolean {
    return parseAccelerator(accelerator) !== null;
  }
}
