// The dictation tab: style selector → push-to-talk → live result card → this-session list. Owns the
// mic pre-prompt gate (getUserMedia only fires after the user accepts). Wires the injected client +
// capture factories through the useDictation hook.
import { useEffect, useState, type JSX } from 'react';
import { useDictation, type DictationDeps, type UsageState } from '../dictation/useDictation';
import type { ClipboardLike } from './copy';
import { MicPermission } from './MicPermission';
import { PushToTalk } from './PushToTalk';
import { ResultCard } from './ResultCard';
import { SessionList } from './SessionList';
import { StyleSelector } from './StyleSelector';

export interface DictationSurfaceProps {
  deps: DictationDeps;
  onUsage?: (usage: UsageState) => void;
  /** Test seam for the copy button. */
  copy?: (text: string) => Promise<boolean>;
  clipboard?: ClipboardLike;
  /** Start with the mic primer already accepted (tests). */
  micEnabledByDefault?: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  idle: 'Connecting…',
  connecting: 'Connecting…',
  ready: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

export function DictationSurface({
  deps,
  onUsage,
  copy,
  clipboard,
  micEnabledByDefault,
}: DictationSurfaceProps): JSX.Element {
  const d = useDictation(deps);
  const [micEnabled, setMicEnabled] = useState(micEnabledByDefault ?? false);

  useEffect(() => {
    if (d.usage && onUsage) onUsage(d.usage);
  }, [d.usage, onUsage]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="result__head" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Dictate</h2>
          <span className="result__spacer" />
          <span className="status-dot" data-status={d.status}>
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        </div>

        <p className="eyebrow">Style</p>
        <StyleSelector value={d.style} onChange={d.setStyle} disabled={d.isRecording} />

        {d.error ? (
          <div className="banner" role="alert" style={{ marginTop: '1rem' }}>
            <span>{d.error.message}</span>
            <span className="banner__spacer" />
            <button type="button" className="btn btn--small btn--ghost" onClick={d.dismissError}>
              Dismiss
            </button>
          </div>
        ) : null}

        {micEnabled ? (
          <PushToTalk
            isRecording={d.isRecording}
            micLevel={d.micLevel}
            disabled={d.status !== 'ready'}
            onStart={d.startTalking}
            onStop={d.stopTalking}
          />
        ) : (
          <div style={{ paddingBlock: '1.5rem' }}>
            <MicPermission onEnable={() => setMicEnabled(true)} />
          </div>
        )}
      </section>

      <section className="panel">
        <ResultCard utterance={d.latest} copy={copy} clipboard={clipboard} />
        <SessionList utterances={d.utterances} />
      </section>
    </div>
  );
}
