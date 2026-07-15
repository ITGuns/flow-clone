// The push-to-talk control: hold SPACEBAR (global) or press-and-hold the on-screen button. Mirrors
// the desktop key-down/key-up interaction (ARCHITECTURE §2) translated to the browser. A live mic
// level animates the ring + cadence bars so silent-mic failure is visible.
import { useEffect, useRef, type CSSProperties, type JSX } from 'react';
import { MicIcon } from './icons';

export interface PushToTalkProps {
  isRecording: boolean;
  micLevel: number;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}

const BARS = 5;

function isFormField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

export function PushToTalk({
  isRecording,
  micLevel,
  disabled,
  onStart,
  onStop,
}: PushToTalkProps): JSX.Element {
  const holdingRef = useRef(false);
  const startRef = useRef(onStart);
  const stopRef = useRef(onStop);
  const disabledRef = useRef(disabled);
  startRef.current = onStart;
  stopRef.current = onStop;
  disabledRef.current = disabled;

  useEffect(() => {
    const isSpace = (e: KeyboardEvent): boolean => e.code === 'Space' || e.key === ' ';
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isSpace(e) || isFormField(e.target)) return;
      e.preventDefault(); // no page scroll
      if (e.repeat || disabledRef.current || holdingRef.current) return;
      holdingRef.current = true;
      startRef.current();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!isSpace(e) || !holdingRef.current) return;
      e.preventDefault();
      holdingRef.current = false;
      stopRef.current();
    };
    const onBlur = (): void => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      stopRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const pressStart = (): void => {
    if (disabled || holdingRef.current) return;
    holdingRef.current = true;
    onStart();
  };
  const pressStop = (): void => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    onStop();
  };

  const level = Math.min(1, Math.max(0, micLevel));
  const bars = Array.from({ length: BARS }, (_, i) => {
    const wobble = 0.55 + 0.45 * Math.abs(Math.sin((i + 1) * 1.2));
    return Math.min(1, level * wobble + (isRecording ? 0.08 : 0));
  });

  return (
    <div className="ptt">
      <button
        type="button"
        className={`ptt__button${isRecording ? ' is-recording' : ''}`}
        disabled={disabled}
        aria-pressed={isRecording}
        aria-label={isRecording ? 'Recording — release to finish' : 'Hold to talk'}
        onMouseDown={pressStart}
        onMouseUp={pressStop}
        onMouseLeave={pressStop}
        style={{ '--level': String(level) } as CSSProperties}
      >
        <span className="ptt__ring" aria-hidden="true" />
        {isRecording ? (
          <span className="ptt__cadence" aria-hidden="true">
            {bars.map((h, i) => (
              <i key={i} style={{ '--level': String(h) } as CSSProperties} />
            ))}
          </span>
        ) : (
          <MicIcon />
        )}
        <span className="ptt__label">{isRecording ? 'Listening…' : 'Hold to talk'}</span>
      </button>
      <p className="ptt__hint">
        Hold <kbd>Space</kbd> or press and hold the button, then release to finish.
      </p>
    </div>
  );
}
