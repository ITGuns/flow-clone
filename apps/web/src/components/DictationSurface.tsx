// The dictation tab: style selector → push-to-talk → live result card → this-session list. Owns the
// mic pre-prompt gate (getUserMedia only fires after the user accepts). Two interchangeable engines
// drive the SAME presentation (`DictationPanels`): the WS streaming path (useDictation) and the
// browser-native speech path (useBrowserDictation, D-026). Mode is chosen by the caller (App) from
// healthz `speech` + recognizer availability; the UX is identical either way.
import { useEffect, useState, type JSX } from 'react';
import {
  useDictation,
  type DictationDeps,
  type UseDictation,
  type UsageState,
} from '../dictation/useDictation';
import { useBrowserDictation, type BrowserDictationDeps } from '../dictation/useBrowserDictation';
import type { ClipboardLike } from './copy';
import { MicPermission } from './MicPermission';
import { PushToTalk } from './PushToTalk';
import { ResultCard } from './ResultCard';
import { SessionList } from './SessionList';
import { StyleSelector } from './StyleSelector';

/** Which recognition engine backs the surface. `ws` = streaming gateway; `browser` = Web Speech. */
export type DictationMode = 'ws' | 'browser';

export interface DictationSurfaceProps {
  deps: DictationDeps;
  /** Engine selection; defaults to the WS streaming path. */
  mode?: DictationMode;
  /** Required when `mode === 'browser'` — the recognizer + format-endpoint collaborators. */
  browser?: BrowserDictationDeps;
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

/** Shared props for the presentational panels (independent of the engine driving them). */
interface PanelProps {
  micEnabled: boolean;
  onEnableMic: () => void;
  copy?: (text: string) => Promise<boolean>;
  clipboard?: ClipboardLike;
}

/** Bridge the engine's usage up to the caller (the header usage meter) whenever it changes. */
function useUsageBridge(usage: UsageState | null, onUsage?: (usage: UsageState) => void): void {
  useEffect(() => {
    if (usage && onUsage) onUsage(usage);
  }, [usage, onUsage]);
}

/** The engine-agnostic presentation: status head, style selector, error banner, PTT, result, list. */
function DictationPanels({
  d,
  micEnabled,
  onEnableMic,
  copy,
  clipboard,
}: PanelProps & { d: UseDictation }): JSX.Element {
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
            <MicPermission onEnable={onEnableMic} />
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

/** WS streaming engine container. */
function WsDictation({
  deps,
  onUsage,
  ...panel
}: PanelProps & { deps: DictationDeps; onUsage?: (usage: UsageState) => void }): JSX.Element {
  const d = useDictation(deps);
  useUsageBridge(d.usage, onUsage);
  return <DictationPanels d={d} {...panel} />;
}

/** Browser-native speech engine container (D-026). */
function BrowserDictation({
  browser,
  onUsage,
  ...panel
}: PanelProps & {
  browser: BrowserDictationDeps;
  onUsage?: (usage: UsageState) => void;
}): JSX.Element {
  const d = useBrowserDictation(browser);
  useUsageBridge(d.usage, onUsage);
  return <DictationPanels d={d} {...panel} />;
}

export function DictationSurface({
  deps,
  mode = 'ws',
  browser,
  onUsage,
  copy,
  clipboard,
  micEnabledByDefault,
}: DictationSurfaceProps): JSX.Element {
  const [micEnabled, setMicEnabled] = useState(micEnabledByDefault ?? false);
  const panel: PanelProps = {
    micEnabled,
    onEnableMic: () => setMicEnabled(true),
    ...(copy ? { copy } : {}),
    ...(clipboard ? { clipboard } : {}),
  };

  // Conditionally RENDER one engine container (each calls its own hook unconditionally — no
  // rules-of-hooks violation). Browser mode requires its collaborators; otherwise fall back to WS.
  return mode === 'browser' && browser ? (
    <BrowserDictation browser={browser} onUsage={onUsage} {...panel} />
  ) : (
    <WsDictation deps={deps} onUsage={onUsage} {...panel} />
  );
}
