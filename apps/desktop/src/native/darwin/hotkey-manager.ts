// HotkeyManager (CONTRACTS.md §2.3) for darwin. Wraps the raw CGEventTap binding with:
//  - accelerator parsing / validation (isSupported),
//  - transition de-bounce (the OS delivers key auto-repeat as repeated keyDowns; PTT wants ONE
//    'down' until the matching 'up'),
//  - fan-out to the subscriber, and clean unregister.
import type { HotkeyManager } from '../types';
import type { MacNativeBinding } from './binding';
import { parseAccelerator } from './accelerator';

export class DarwinHotkeyManager implements HotkeyManager {
  constructor(private readonly binding: MacNativeBinding) {}

  isSupported(accelerator: string): boolean {
    return parseAccelerator(accelerator) !== null;
  }

  register(accelerator: string, cb: (phase: 'down' | 'up') => void): () => void {
    const parsed = parseAccelerator(accelerator);
    if (parsed === null) {
      throw new Error(`Unsupported accelerator: ${JSON.stringify(accelerator)}`);
    }

    // De-bounce: hold the pressed state so auto-repeat keyDowns don't re-fire 'down', and a stray
    // 'up' without a preceding 'down' is ignored. cb sees strictly alternating transitions.
    let pressed = false;
    let active = true;

    const handle = this.binding.hotkeyRegister(parsed.keyCode, parsed.modifiers, (phase) => {
      if (!active) return;
      if (phase === 'down') {
        if (pressed) return;
        pressed = true;
        cb('down');
      } else {
        if (!pressed) return;
        pressed = false;
        cb('up');
      }
    });

    return () => {
      if (!active) return;
      active = false;
      this.binding.hotkeyUnregister(handle);
    };
  }
}
