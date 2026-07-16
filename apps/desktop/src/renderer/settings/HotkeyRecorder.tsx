// Push-to-talk hotkey recorder (task 4c). Click "Record", press a key combination, and it captures an
// Electron accelerator string via the pure `acceleratorFromEvent` helper, validates it against an
// injected `isSupported` port (the real one is the native `HotkeyManager.isSupported`, wired at the
// Phase 4 gate), and surfaces a soft conflict hint for bare printable keys. Reset restores the default.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { DEFAULT_HOTKEY } from '../../settings-schema';
import { acceleratorFromEvent, describeHotkeyConflict } from './accelerator-capture';

export interface HotkeyRecorderProps {
  /** Current accelerator string. */
  value: string;
  /** Called with a new, validated accelerator. */
  onChange: (accelerator: string) => void;
  /** Whether the OS can bind this accelerator (native `HotkeyManager.isSupported` at the gate). */
  isSupported: (accelerator: string) => boolean;
  /** Accelerator restored by "Reset" (defaults to the schema default). */
  defaultHotkey?: string;
}

export function HotkeyRecorder({
  value,
  onChange,
  isSupported,
  defaultHotkey = DEFAULT_HOTKEY,
}: HotkeyRecorderProps): ReactElement {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();

  useEffect(() => {
    if (recording) buttonRef.current?.focus();
  }, [recording]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording) return;
    // While recording, swallow keys so they neither scroll the page nor activate the button.
    e.preventDefault();
    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }
    const accelerator = acceleratorFromEvent(e);
    if (accelerator === null) return; // modifiers-only / unmappable — keep waiting
    if (!isSupported(accelerator)) {
      setError(`"${accelerator}" can't be used as a global shortcut on this system.`);
      setRecording(false);
      return;
    }
    setError(null);
    setRecording(false);
    onChange(accelerator);
  }

  function startRecording(): void {
    setError(null);
    setRecording(true);
  }

  function reset(): void {
    setError(null);
    setRecording(false);
    onChange(defaultHotkey);
  }

  const conflict = !recording && error === null ? describeHotkeyConflict(value) : null;

  return (
    <div className="uts-row">
      <div className="uts-row-main">
        <p className="uts-row-label">Push-to-talk shortcut</p>
        <p className="uts-row-hint">
          Hold this key while you speak. Pick a function key or add a modifier.
        </p>
        {conflict ? (
          <p className="uts-hint" role="note">
            {conflict}
          </p>
        ) : null}
        {error ? (
          <p className="uts-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="uts-actions">
        <span className="uts-kbd" data-testid="hotkey-value">
          {recording ? 'Press a key…' : value}
        </span>
        <button
          ref={buttonRef}
          type="button"
          className={`uts-btn${recording ? ' uts-btn-recording' : ''}`}
          aria-pressed={recording}
          aria-describedby={statusId}
          onClick={recording ? () => setRecording(false) : startRecording}
          onKeyDown={handleKeyDown}
        >
          {recording ? 'Recording…' : 'Record'}
        </button>
        <button
          type="button"
          className="uts-btn"
          onClick={reset}
          disabled={value === defaultHotkey}
        >
          Reset
        </button>
        <span id={statusId} className="uts-visually-hidden" hidden>
          {recording ? 'Recording a new shortcut. Press Escape to cancel.' : ''}
        </span>
      </div>
    </div>
  );
}
