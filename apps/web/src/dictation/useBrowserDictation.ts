// The browser-native speech dictation orchestrator (D-026). A drop-in counterpart to useDictation:
// it exposes the SAME `UseDictation` surface so the dictation UI is identical, but instead of the WS
// streaming pipeline it drives the browser's Web Speech recognizer locally and sends the finalized
// transcript to POST /v1/format for the same server-side formatting + history + metering.
//
// Flow: hold → recognizer.start() (interim results render as the live partial) → release →
// recognizer.stop() resolves the final transcript → api.formatTranscript(transcript, appContext) →
// ResultCard + session list + usage update. The reducer (session-state.ts) is shared with the WS
// path, so the partial → final → done progression and the §8 honest states render identically.
//
// Mic level: the Web Speech API exposes no audio amplitude, so the ring is ACTIVITY-driven — it
// pulses on each interim result rather than reflecting true loudness (documented; the recording
// glow still animates so a silent mic is visible).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AppContext } from '@undertone/shared';
import type { FormatTranscriptResult } from '../api/client';
import type { Recognizer, RecognizerError } from '../speech/browser-recognizer';
import { DEFAULT_STYLE, buildAppContext, type DictationStyle } from '../register';
import { latest, sessionReducer } from './session-state';
import type { UseDictation, UsageState } from './useDictation';
import type { DictationError } from '../ws/dictation-client';

export interface BrowserDictationDeps {
  /** Construct the (reusable) recognizer — a scripted fake in tests. */
  createRecognizer(): Recognizer;
  /** POST /v1/format — send the finalized transcript for server-side formatting. */
  formatTranscript(transcript: string, appContext: AppContext): Promise<FormatTranscriptResult>;
}

/** A friendly, honest message for each vendor recognizer error code. */
function messageForRecognizerError(error: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser to dictate.';
    case 'no-speech':
      return "We didn't catch any speech — hold and try again.";
    case 'audio-capture':
      return 'No microphone was found. Check your device and try again.';
    case 'network':
      return 'The speech service is unreachable. Check your connection and try again.';
    default:
      return 'Speech recognition failed. Please try again.';
  }
}

/** Errors the user can just retry; permission/no-device errors are not auto-retryable. */
function isRetryable(error: string): boolean {
  return error !== 'not-allowed' && error !== 'service-not-allowed' && error !== 'audio-capture';
}

export function useBrowserDictation(deps: BrowserDictationDeps): UseDictation {
  const [utterances, dispatch] = useReducer(sessionReducer, []);
  const [isRecording, setIsRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [style, setStyle] = useState<DictationStyle>(DEFAULT_STYLE);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [error, setError] = useState<DictationError | null>(null);

  const recognizerRef = useRef<Recognizer | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const activeContextRef = useRef<AppContext | null>(null);
  const counterRef = useRef(0);
  const pulseRef = useRef(0.5);
  const styleRef = useRef<DictationStyle>(style);
  styleRef.current = style;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // One long-lived recognizer, created once and reused per utterance (aborts on unmount).
  useEffect(() => {
    const recognizer = depsRef.current.createRecognizer();
    recognizerRef.current = recognizer;
    return () => {
      recognizer.abort();
    };
  }, []);

  /** A recognizer error (mic denied, network, no-speech, …) → honest error state; ends recording. */
  const handleRecognizerError = useCallback((err: RecognizerError): void => {
    const id = activeIdRef.current;
    if (id === null) return; // late/benign error after the utterance already settled
    activeIdRef.current = null;
    setIsRecording(false);
    setMicLevel(0);
    const message = messageForRecognizerError(err.error);
    setError({ code: 'INTERNAL', message, retryable: isRetryable(err.error) });
    dispatch({ type: 'error', id, message });
    recognizerRef.current?.abort();
  }, []);

  /** Finalized transcript in hand → format it server-side and land the result. */
  const finalizeUtterance = useCallback(async (id: number, transcript: string): Promise<void> => {
    if (activeIdRef.current !== id) return; // an error already claimed this utterance
    activeIdRef.current = null;

    dispatch({ type: 'final', id, text: transcript });
    if (transcript.trim() === '') {
      // Released without speaking — nothing to format, persist, or meter.
      dispatch({ type: 'done', id, text: '', wordCount: 0, unformatted: false });
      return;
    }

    const appContext = activeContextRef.current ?? buildAppContext(styleRef.current);
    try {
      const result = await depsRef.current.formatTranscript(transcript, appContext);
      dispatch({
        type: 'done',
        id,
        text: result.text,
        wordCount: result.wordCount,
        unformatted: result.unformatted ?? false,
      });
      if (result.usage)
        setUsage({ wordsThisWeek: result.usage.wordsThisWeek, limit: result.usage.limit });
      if (result.exceeded) dispatch({ type: 'quota', id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Formatting failed.';
      setError({ code: 'INTERNAL', message, retryable: true });
      dispatch({ type: 'error', id, message });
    }
  }, []);

  const startTalking = useCallback((): void => {
    const recognizer = recognizerRef.current;
    if (!recognizer || isRecording) return;
    setError(null);
    const currentStyle = styleRef.current;
    const id = counterRef.current + 1;
    counterRef.current = id;
    activeIdRef.current = id;
    activeContextRef.current = buildAppContext(currentStyle);
    dispatch({ type: 'begin', id, style: currentStyle });
    setIsRecording(true);
    pulseRef.current = 0.5;
    setMicLevel(0.5);

    recognizer.start({
      onInterim: (text) => {
        if (activeIdRef.current !== id) return;
        dispatch({ type: 'partial', id, text });
        // Activity-driven ring: nudge the level on each interim so the bars animate.
        pulseRef.current = pulseRef.current >= 0.7 ? 0.45 : 0.75;
        setMicLevel(pulseRef.current);
      },
      onError: handleRecognizerError,
    });
  }, [isRecording, handleRecognizerError]);

  const stopTalking = useCallback((): void => {
    if (!isRecording) return;
    setIsRecording(false);
    setMicLevel(0);
    const id = activeIdRef.current;
    const recognizer = recognizerRef.current;
    if (id === null || !recognizer) return;
    dispatch({ type: 'transcribing', id });
    recognizer.stop().then(
      (transcript) => void finalizeUtterance(id, transcript),
      () => void finalizeUtterance(id, ''),
    );
  }, [isRecording, finalizeUtterance]);

  const dismissError = useCallback((): void => setError(null), []);

  return useMemo<UseDictation>(
    () => ({
      status: 'ready',
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
}
