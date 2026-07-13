// WebSocket JSON control protocol — CONTRACTS.md §4.3. Every JSON message is `{ t, ...fields }`;
// the discriminant is `t`. Binary audio frames are handled separately by `frame-codec.ts`.
import type { AppContext, SessionId, UtteranceId } from './types';
import type { ErrorCode, UndertoneError } from './errors';

// Timing marks — CONTRACTS.md §9. All ms since t_keyup; never contains transcript content.
export type TimingMark =
  | 't_keyup'
  | 't_audio_end_sent'
  | 't_asr_final'
  | 't_prompt_built'
  | 't_format_ttft'
  | 't_format_done'
  | 't_client_first_delta'
  | 't_inject_done';

export type Timings = Partial<Record<TimingMark, number>>;

// ── Client → server ────────────────────────────────────────────────────────────────────────
export interface SessionStartMessage {
  t: 'session.start';
  sessionId: SessionId;
  appContext: AppContext;
  locale: string;
}
export interface UtteranceStartMessage {
  t: 'utterance.start';
  utteranceId: UtteranceId;
  appContext: AppContext;
}
export interface AudioEndMessage {
  t: 'audio.end';
  utteranceId: UtteranceId;
  lastFrameSeq: number;
}
export interface SessionResumeMessage {
  t: 'session.resume';
  sessionId: SessionId;
  utteranceId: UtteranceId;
  lastAckedFrameSeq: number;
}
export interface PingMessage {
  t: 'ping';
  ts: number;
}

export type ClientMessage =
  | SessionStartMessage
  | UtteranceStartMessage
  | AudioEndMessage
  | SessionResumeMessage
  | PingMessage;

// ── Server → client ────────────────────────────────────────────────────────────────────────
export interface SessionReadyMessage {
  t: 'session.ready';
  sessionId: SessionId;
}
export interface AudioAckMessage {
  t: 'audio.ack';
  utteranceId: UtteranceId;
  frameSeq: number;
}
export interface TranscriptPartialMessage {
  t: 'transcript.partial';
  utteranceId: UtteranceId;
  text: string;
}
export interface TranscriptFinalMessage {
  t: 'transcript.final';
  utteranceId: UtteranceId;
  text: string;
  asrMs: number;
}
export interface FormatDeltaMessage {
  t: 'format.delta';
  utteranceId: UtteranceId;
  text: string;
}
export interface FormatDoneMessage {
  t: 'format.done';
  utteranceId: UtteranceId;
  text: string;
  wordCount: number;
  timings: Timings;
}
export interface UsageUpdateMessage {
  t: 'usage.update';
  wordsThisWeek: number;
  limit: number;
}
export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  message: string;
  retryable: boolean;
  utteranceId?: UtteranceId;
}
export interface PongMessage {
  t: 'pong';
  ts: number;
}

export type ServerMessage =
  | SessionReadyMessage
  | AudioAckMessage
  | TranscriptPartialMessage
  | TranscriptFinalMessage
  | FormatDeltaMessage
  | FormatDoneMessage
  | UsageUpdateMessage
  | ErrorMessage
  | PongMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;

/** Serialize an application error onto the §4.3 `error` wire frame. */
export function toErrorMessage(err: UndertoneError): ErrorMessage {
  return {
    t: 'error',
    code: err.code,
    message: err.message,
    retryable: err.retryable,
    ...(err.utteranceId !== undefined ? { utteranceId: err.utteranceId } : {}),
  };
}
