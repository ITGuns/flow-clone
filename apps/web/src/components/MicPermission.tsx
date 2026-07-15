// In-page microphone explanation shown BEFORE the browser permission prompt (BUILD_GUIDE §3 /
// ARCHITECTURE §non-negotiables). The real getUserMedia call only happens once the user accepts
// here and then presses to talk, so the OS prompt is never sprung on them cold.
import type { JSX } from 'react';
import { MicIcon } from './icons';

export interface MicPermissionProps {
  onEnable: () => void;
}

export function MicPermission({ onEnable }: MicPermissionProps): JSX.Element {
  return (
    <div className="primer">
      <div className="primer__icon">
        <MicIcon />
      </div>
      <h2>Turn on your microphone</h2>
      <p className="muted">
        Undertone streams your speech to transcribe it in real time and drops polished text back
        here. Your audio is processed and discarded — it is never stored. Your browser will ask for
        microphone access next.
      </p>
      <button type="button" className="btn" onClick={onEnable}>
        Enable microphone
      </button>
    </div>
  );
}
