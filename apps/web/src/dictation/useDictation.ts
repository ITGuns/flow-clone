// The dictation orchestrator hook. Owns the long-lived WS client + a per-utterance AudioCapture,
// translates their events into the pure session reducer, and exposes the push-to-talk handlers the
// UI binds to spacebar / the on-screen button. Both the client and the capture are INJECTED so the
// component tests drive fakes (and never pull the shared golden side-effect into the jsdom bundle).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AudioCaptureLike } from '../audio/audio-capture';
import type {
  ConnectionStatus,
  DictationClientLike,
  DictationError,
  DictationEvents,
} from '../ws/dictation-client';
import { DEFAULT_STYLE, buildAppContext, type DictationStyle } from '../register';
import { latest, sessionReducer, type Utterance } from './session-state';

export interface DictationDeps {
  createClient(events: DictationEvents): DictationClientLike;
  createCapture(): AudioCaptureLike;
}

export interface UsageState {
  wordsThisWeek: number;
  limit: number;
}

export interface UseDictation {
  status: ConnectionStatus;
  utterances: Utterance[];
  latest: Utterance | null;
  isRecording: boolean;
  micLevel: number;
  style: DictationStyle;
  usage: UsageState | null;
  error: DictationError | null;
  setStyle(style: DictationStyle): void;
  startTalking(): void;
  stopTalking(): void;
  dismissError(): void;
}

export function useDictation(deps: DictationDeps): UseDictation {
  const [utterances, dispatch] = useReducer(sessionReducer, []);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [style, setStyle] = useState<DictationStyle>(DEFAULT_STYLE);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [error, setError] = useState<DictationError | null>(null);

  const clientRef = useRef<DictationClientLike | null>(null);
  const captureRef = useRef<AudioCaptureLike | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const styleRef = useRef<DictationStyle>(style);
  styleRef.current = style;
  // `createClient`/`createCapture` are read from a ref so the mount effect never re-runs when a
  // caller passes a fresh `deps` object each render.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const events: DictationEvents = {
      onStatus: (s) => setStatus(s),
      onPartial: (id, text) => dispatch({ type: 'partial', id, text }),
      onFinal: (id, text) => dispatch({ type: 'final', id, text }),
      onFormatDelta: (id, text) => dispatch({ type: 'delta', id, text }),
      onFormatDone: (r) =>
        dispatch({
          type: 'done',
          id: r.utteranceId,
          text: r.text,
          wordCount: r.wordCount,
          unformatted: r.unformatted,
        }),
      onUsage: (wordsThisWeek, limit) => setUsage({ wordsThisWeek, limit }),
      onQuotaExceeded: (id) => dispatch({ type: 'quota', id }),
      onError: (e) => {
        setError(e);
        if (activeIdRef.current !== null) {
          dispatch({ type: 'error', id: activeIdRef.current, message: e.message });
        }
      },
    };
    const client = depsRef.current.createClient(events);
    clientRef.current = client;
    client.connect(buildAppContext(styleRef.current)).catch((err: unknown) => {
      setError({
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Could not connect.',
        retryable: true,
      });
    });
    return () => {
      client.close();
      const capture = captureRef.current;
      if (capture) void capture.stop().catch(() => undefined);
    };
  }, []);

  const startTalking = useCallback((): void => {
    const client = clientRef.current;
    if (!client || isRecording) return;
    if (client.getStatus() !== 'ready') return;
    setError(null);
    const currentStyle = styleRef.current;
    const id = client.beginUtterance(buildAppContext(currentStyle));
    activeIdRef.current = id;
    dispatch({ type: 'begin', id, style: currentStyle });
    setIsRecording(true);

    const capture = depsRef.current.createCapture();
    captureRef.current = capture;
    capture.onFrame((frame) => clientRef.current?.sendAudioFrame(frame));
    capture.onVad((r) => setMicLevel(r.level));
    capture.onError((err) => {
      setError({ code: 'INTERNAL', message: err.message, retryable: false });
    });
    capture.start().catch((err: unknown) => {
      setIsRecording(false);
      setMicLevel(0);
      const message = err instanceof Error ? err.message : 'Microphone unavailable.';
      setError({ code: 'INTERNAL', message, retryable: false });
      if (activeIdRef.current !== null) {
        dispatch({ type: 'error', id: activeIdRef.current, message });
      }
    });
  }, [isRecording]);

  const stopTalking = useCallback((): void => {
    if (!isRecording) return;
    setIsRecording(false);
    setMicLevel(0);
    const id = activeIdRef.current;
    if (id !== null) dispatch({ type: 'transcribing', id });
    const capture = captureRef.current;
    captureRef.current = null;
    const finish = (): void => clientRef.current?.endUtterance();
    if (capture) {
      capture.stop().then(finish, finish);
    } else {
      finish();
    }
  }, [isRecording]);

  const dismissError = useCallback((): void => setError(null), []);

  const value = useMemo<UseDictation>(
    () => ({
      status,
      utterances,
      latest: latest(utterances),
      isRecording,
      micLevel,
      style,
      usage,
      error,
      setStyle,
      startTalking,
      stopTalking,
      dismissError,
    }),
    [
      status,
      utterances,
      isRecording,
      micLevel,
      style,
      usage,
      error,
      startTalking,
      stopTalking,
      dismissError,
    ],
  );
  return value;
}
