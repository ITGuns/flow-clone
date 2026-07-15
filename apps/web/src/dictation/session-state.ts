// Pure reducer for the in-session list of utterances. Kept free of React and I/O so the
// partial → final → format-delta → done progression (and the §8 honest states: raw-fallback,
// quota) is unit-testable in isolation. Newest utterance is first.
import type { DictationStyle } from '../register';

export type UtterancePhase = 'recording' | 'transcribing' | 'formatting' | 'done' | 'error';

export interface Utterance {
  id: number;
  style: DictationStyle;
  phase: UtterancePhase;
  /** Live cumulative ASR partial (shown while speaking / transcribing). */
  partial: string;
  /** Final ASR transcript (also the raw text used on a §8 FORMAT_* fallback). */
  transcript: string;
  /** Formatted text (assembled deltas, then the authoritative final). */
  text: string;
  wordCount: number;
  /** §8 FORMAT_* fallback: the server delivered the raw transcript, unformatted. */
  unformatted: boolean;
  /** §8 QUOTA_EXCEEDED: result delivered, but the weekly cap was passed. */
  quotaExceeded: boolean;
  errorMessage: string | null;
}

export type SessionAction =
  | { type: 'begin'; id: number; style: DictationStyle }
  | { type: 'transcribing'; id: number }
  | { type: 'partial'; id: number; text: string }
  | { type: 'final'; id: number; text: string }
  | { type: 'delta'; id: number; text: string }
  | { type: 'done'; id: number; text: string; wordCount: number; unformatted: boolean }
  | { type: 'quota'; id: number }
  | { type: 'error'; id: number; message: string };

function newUtterance(id: number, style: DictationStyle): Utterance {
  return {
    id,
    style,
    phase: 'recording',
    partial: '',
    transcript: '',
    text: '',
    wordCount: 0,
    unformatted: false,
    quotaExceeded: false,
    errorMessage: null,
  };
}

function patch(state: Utterance[], id: number, fn: (u: Utterance) => Utterance): Utterance[] {
  return state.map((u) => (u.id === id ? fn(u) : u));
}

export function sessionReducer(state: Utterance[], action: SessionAction): Utterance[] {
  switch (action.type) {
    case 'begin':
      return [newUtterance(action.id, action.style), ...state];
    case 'transcribing':
      return patch(state, action.id, (u) =>
        u.phase === 'recording' ? { ...u, phase: 'transcribing' } : u,
      );
    case 'partial':
      return patch(state, action.id, (u) => ({ ...u, partial: action.text }));
    case 'final':
      return patch(state, action.id, (u) => ({
        ...u,
        transcript: action.text,
        partial: action.text,
        phase: u.phase === 'error' ? u.phase : 'formatting',
      }));
    case 'delta':
      return patch(state, action.id, (u) => ({ ...u, text: u.text + action.text }));
    case 'done':
      return patch(state, action.id, (u) => ({
        ...u,
        text: action.text,
        wordCount: action.wordCount,
        unformatted: action.unformatted,
        phase: 'done',
      }));
    case 'quota':
      return patch(state, action.id, (u) => ({ ...u, quotaExceeded: true }));
    case 'error':
      return patch(state, action.id, (u) => ({
        ...u,
        phase: 'error',
        errorMessage: action.message,
      }));
    default:
      return state;
  }
}

/** The most recent utterance (the one the result card renders), or null when the session is empty. */
export function latest(state: Utterance[]): Utterance | null {
  return state[0] ?? null;
}
