// Public seams for the desktop WebSocket client — CONTRACTS.md §4. Every protocol shape is
// imported from @undertone/shared and never redeclared here; this file only declares the
// injection boundaries (Transport, TokenProvider) and the client's own event surface.
import type {
  AudioAckMessage,
  ErrorMessage,
  FormatDeltaMessage,
  FormatDoneMessage,
  PongMessage,
  SessionId,
  SessionReadyMessage,
  TranscriptFinalMessage,
  TranscriptPartialMessage,
  UsageUpdateMessage,
  UtteranceId,
} from '@undertone/shared';

/**
 * One open bidirectional connection. All WsClient logic runs against this narrow surface so it
 * is fully unit-testable with a scripted fake; the production impl (`websocket-transport.ts`)
 * wraps the global `WebSocket`. Payloads are `string` for JSON control frames (§4.3) and
 * `Uint8Array` for binary audio frames (§4.2, client→server only).
 */
export interface TransportConnection {
  /** Enqueue a frame for the wire. May buffer internally; see `bufferedAmount`. */
  send(data: string | Uint8Array): void;
  /** Register the single message sink. Any frames received before this is set are buffered. */
  onMessage(cb: (data: string | Uint8Array) => void): void;
  /** Register the close sink. Fires once with the close code/reason. */
  onClose(cb: (info: TransportCloseInfo) => void): void;
  /** Bytes queued in the OS/socket send buffer but not yet flushed — drives backpressure (§4.4). */
  bufferedAmount(): number;
  /** Begin an orderly close. Idempotent. */
  close(code?: number, reason?: string): void;
}

export interface TransportCloseInfo {
  code: number;
  reason: string;
}

/** Opens connections. Injected so tests script a FakeTransport; prod wraps `WebSocket`. */
export interface Transport {
  connect(url: string): Promise<TransportConnection>;
}

/**
 * Supplies a fresh short-lived JWT for the connection query string (§4.1). Clerk arrives in
 * Phase 3; until then a fake is injected. `getToken` is invoked on EVERY (re)connect so that
 * reconnects never present a stale token.
 */
export interface TokenProvider {
  getToken(): Promise<string>;
}

/**
 * Connection-lifecycle state exposed to the caller. This is the transport-level view; it is
 * distinct from (but drives) the CONTRACTS.md §3 session state machine owned by the orchestrator.
 * `buffering` mirrors §3: a transport loss mid-utterance while audio is retained for replay.
 */
export type ConnectionState = 'connecting' | 'connected' | 'ready' | 'buffering' | 'closed';

/** Emitted when a `session.resume` is rejected (§4.4 / §8 SESSION_INVALID) — the caller drives
 * the offline-buffer path (task 5a); this client does not persist audio. */
export interface SessionInvalidEvent {
  sessionId: SessionId | undefined;
  utteranceId: UtteranceId | undefined;
}

/**
 * Every event the client emits: one per Server→client message type (§4.3), plus `state` for
 * connection transitions and `sessionInvalid` for the offline handoff. Payloads are the exact
 * @undertone/shared wire types.
 */
export interface WsClientEventMap {
  'session.ready': SessionReadyMessage;
  'audio.ack': AudioAckMessage;
  'transcript.partial': TranscriptPartialMessage;
  'transcript.final': TranscriptFinalMessage;
  'format.delta': FormatDeltaMessage;
  'format.done': FormatDoneMessage;
  'usage.update': UsageUpdateMessage;
  error: ErrorMessage;
  pong: PongMessage;
  state: ConnectionState;
  sessionInvalid: SessionInvalidEvent;
}
