// Desktop WebSocket client — CONTRACTS.md §4, end to end from the client side:
// connection/auth (§4.1), binary audio framing (§4.2), JSON control (§4.3), and the
// ordering/reconnect/replay/backpressure rules (§4.4). All protocol shapes are imported from
// @undertone/shared; none are redeclared. All socket I/O goes through the injected `Transport`,
// so every rule below is exercised against a scripted fake in the unit tests.
import {
  encodeAudioFrame,
  UndertoneError,
  toErrorMessage,
  type ClientMessage,
  type ErrorMessage,
  type SessionId,
  type SessionResumeMessage,
  type SessionStartMessage,
  type ServerMessage,
  type UtteranceId,
} from '@undertone/shared';
import { TypedEmitter, type Listener } from './emitter';
import type {
  ConnectionState,
  TokenProvider,
  Transport,
  TransportCloseInfo,
  TransportConnection,
  WsClientEventMap,
} from './types';

export interface WsClientOptions {
  /** Gateway host, e.g. `api.undertone.app`. The `wss://<host>/v1/stream?token=` URL is built here. */
  host: string;
  transport: Transport;
  tokenProvider: TokenProvider;
  /** Heartbeat ping cadence (§4.1). Default 15000ms. */
  heartbeatIntervalMs?: number;
  /** Consecutive unanswered pings that count as a drop (§4.1). Default 2. */
  maxMissedPongs?: number;
  /** Delay before a reconnect attempt after a drop. Default 500ms. */
  reconnectDelayMs?: number;
  /** Replay ring buffer cap in frames (§4.4 — 30s of 20ms audio). Default 1500. */
  replayBufferCap?: number;
  /** Pause pushing into the socket above this bufferedAmount (§4.4). Default 256KiB. */
  backpressureHighWater?: number;
  /** Resume pushing once bufferedAmount falls below this (§4.4). Default 64KiB. */
  backpressureLowWater?: number;
}

interface BufferedFrame {
  seq: number;
  data: Uint8Array;
}

const DEFAULTS = {
  heartbeatIntervalMs: 15_000,
  maxMissedPongs: 2,
  reconnectDelayMs: 500,
  replayBufferCap: 1500,
  backpressureHighWater: 256 * 1024,
  backpressureLowWater: 64 * 1024,
} as const;

export class WsClient {
  private readonly emitter = new TypedEmitter<WsClientEventMap>();
  private readonly host: string;
  private readonly transport: Transport;
  private readonly tokenProvider: TokenProvider;
  private readonly heartbeatIntervalMs: number;
  private readonly maxMissedPongs: number;
  private readonly reconnectDelayMs: number;
  private readonly replayBufferCap: number;
  private readonly highWater: number;
  private readonly lowWater: number;

  private conn: TransportConnection | undefined;
  private state: ConnectionState = 'closed';
  private streaming = false; // true only between session.ready and the next disconnect
  private terminated = false; // set by close() or a terminal error; no further reconnects
  private reconnecting = false; // this connect attempt is a reconnect (auto-resend start/resume)
  private pendingResume = false; // a session.resume is in flight; replay on the next session.ready

  // Session/utterance bookkeeping, sniffed off the control messages the caller sends.
  private sessionId: SessionId | undefined;
  private sessionStartMsg: SessionStartMessage | undefined;
  private activeUtteranceId: UtteranceId | undefined;
  private audioEndSent = false;
  private lastFrameSeq: number | undefined;

  // Replay ring buffer of un-acked frames for the active utterance (§4.4), ordered ascending by
  // seq. Pruned ONLY by audio.ack (≤ acked seq). New frames are rejected when it is full.
  private ring: BufferedFrame[] = [];
  private nextSeq = 0; // next frameSeq to assign (per utterance, from 0)
  private sentSeq = -1; // highest seq handed to the socket on the current connection
  private lastAckedFrameSeq = -1; // highest seq acked by the server (−1 = none)
  private paused = false; // backpressure: true while bufferedAmount is above the high-water mark

  // Control messages issued while the socket was down; flushed on session.ready.
  private pendingControls: ClientMessage[] = [];

  private outstandingPings = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: WsClientOptions) {
    this.host = opts.host;
    this.transport = opts.transport;
    this.tokenProvider = opts.tokenProvider;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
    this.maxMissedPongs = opts.maxMissedPongs ?? DEFAULTS.maxMissedPongs;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? DEFAULTS.reconnectDelayMs;
    this.replayBufferCap = opts.replayBufferCap ?? DEFAULTS.replayBufferCap;
    this.highWater = opts.backpressureHighWater ?? DEFAULTS.backpressureHighWater;
    this.lowWater = opts.backpressureLowWater ?? DEFAULTS.backpressureLowWater;
  }

  // ── Public event surface ─────────────────────────────────────────────────────────────────
  on<K extends keyof WsClientEventMap>(key: K, cb: Listener<WsClientEventMap[K]>): () => void {
    return this.emitter.on(key, cb);
  }
  once<K extends keyof WsClientEventMap>(key: K, cb: Listener<WsClientEventMap[K]>): () => void {
    return this.emitter.once(key, cb);
  }
  off<K extends keyof WsClientEventMap>(key: K, cb: Listener<WsClientEventMap[K]>): void {
    this.emitter.off(key, cb);
  }

  // ── Public getters (mostly for the orchestrator / assertions) ──────────────────────────────
  getState(): ConnectionState {
    return this.state;
  }
  /** Count of un-acked frames currently held for replay. */
  get bufferedFrameCount(): number {
    return this.ring.length;
  }
  get isPaused(): boolean {
    return this.paused;
  }

  // ── Public API ─────────────────────────────────────────────────────────────────────────────

  /** Open the connection (fresh token). The caller then sends `session.start` via sendControl. */
  async connect(): Promise<void> {
    this.terminated = false;
    this.reconnecting = false;
    await this.doConnect();
  }

  /**
   * Queue one audio frame for the active utterance. The client owns frameSeq (§4.2: from 0) and
   * the replay ring buffer. Returns false and emits an `error` event when the ring is full
   * (§4.4 cap) — the frame is rejected WITHOUT consuming a seq, so the stream stays gapless.
   */
  sendFrame(utteranceId: UtteranceId, payload: Uint8Array): boolean {
    if (this.activeUtteranceId === undefined || utteranceId !== this.activeUtteranceId) {
      throw new UndertoneError(
        'PROTO_ERROR',
        `sendFrame(${utteranceId}) without an active utterance.start (active=${String(
          this.activeUtteranceId,
        )})`,
        { utteranceId },
      );
    }
    if (this.ring.length >= this.replayBufferCap) {
      // Replay buffer saturated: never drop a buffered frame or corrupt the seq stream; reject
      // the new one and surface it. Caller falls back to the offline-buffer path (task 5a).
      this.emitError(
        new UndertoneError(
          'OFFLINE_BUFFERED',
          `replay buffer full (${this.replayBufferCap} frames); frame rejected`,
          { retryable: true, utteranceId },
        ),
      );
      return false;
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const data = encodeAudioFrame(utteranceId, seq, payload);
    this.ring.push({ seq, data });
    this.pump();
    return true;
  }

  /**
   * Send a client control message (§4.3). The client sniffs session.start / utterance.start /
   * audio.end to drive resume + replay, then writes to the wire (or queues it if the socket is
   * momentarily down). `session.resume`/`ping` are issued internally and are not expected here.
   */
  sendControl(msg: ClientMessage): void {
    switch (msg.t) {
      case 'session.start':
        this.sessionStartMsg = msg;
        this.sessionId = msg.sessionId;
        break;
      case 'utterance.start':
        this.beginUtterance(msg.utteranceId);
        break;
      case 'audio.end':
        this.audioEndSent = true;
        this.lastFrameSeq = msg.lastFrameSeq;
        break;
      default:
        break;
    }
    this.writeControl(msg);
  }

  /** Orderly, terminal shutdown. No reconnect follows. */
  close(): void {
    this.terminated = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.streaming = false;
    this.closeConn(1000, 'client closed');
    this.setState('closed');
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────────────────────

  private async doConnect(): Promise<void> {
    if (this.terminated) return;
    this.clearReconnect();
    // Mid-utterance reconnects present as `buffering` (§3); everything else as `connecting`.
    this.setState(this.reconnecting && this.activeUtteranceId !== undefined ? 'buffering' : 'connecting');

    let token: string;
    try {
      token = await this.tokenProvider.getToken(); // fresh token on EVERY (re)connect (§4.1)
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.terminated) return;

    const url = `wss://${this.host}/v1/stream?token=${encodeURIComponent(token)}`;
    let conn: TransportConnection;
    try {
      conn = await this.transport.connect(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.terminated) {
      conn.close(1000, 'client closed');
      return;
    }

    this.conn = conn;
    this.outstandingPings = 0;
    conn.onMessage((data) => this.handleMessage(conn, data));
    conn.onClose((info) => this.handleClose(conn, info));
    if (!(this.reconnecting && this.activeUtteranceId !== undefined)) {
      this.setState('connected');
    }
    this.startHeartbeat();

    if (this.reconnecting) {
      if (this.activeUtteranceId !== undefined) {
        // Mid-utterance: resume, then replay from lastAcked+1 once the server acks the session.
        const resume: SessionResumeMessage = {
          t: 'session.resume',
          sessionId: this.sessionId ?? '',
          utteranceId: this.activeUtteranceId,
          lastAckedFrameSeq: this.lastAckedFrameSeq,
        };
        this.pendingResume = true;
        this.raw(resume);
      } else if (this.sessionStartMsg) {
        // Between utterances: re-establish the same session so the socket stays warm.
        this.raw(this.sessionStartMsg);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.terminated) return;
    this.reconnecting = true;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.doConnect();
    }, this.reconnectDelayMs);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /** A drop we detected ourselves (heartbeat). Tear down the dead socket and reconnect. */
  private handleDrop(): void {
    const dead = this.conn;
    this.stopHeartbeat();
    this.streaming = false;
    this.conn = undefined;
    if (dead) {
      try {
        dead.close(4000, 'heartbeat timeout');
      } catch {
        // already closed
      }
    }
    if (this.terminated) {
      this.setState('closed');
      return;
    }
    this.setState(this.activeUtteranceId !== undefined ? 'buffering' : 'connecting');
    this.scheduleReconnect();
  }

  private handleClose(conn: TransportConnection, _info: TransportCloseInfo): void {
    if (conn !== this.conn) return; // a stale/previous socket closing — ignore
    this.stopHeartbeat();
    this.streaming = false;
    this.conn = undefined;
    if (this.terminated) {
      this.setState('closed');
      return;
    }
    this.setState(this.activeUtteranceId !== undefined ? 'buffering' : 'connecting');
    this.scheduleReconnect();
  }

  private closeConn(code: number, reason: string): void {
    const conn = this.conn;
    this.conn = undefined;
    if (conn) {
      try {
        conn.close(code, reason);
      } catch {
        // already closed
      }
    }
  }

  // ── Incoming messages ────────────────────────────────────────────────────────────────────

  private handleMessage(conn: TransportConnection, data: string | Uint8Array): void {
    if (conn !== this.conn) return; // stale connection
    if (typeof data !== 'string') return; // server→client is JSON only (§4.2)
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return; // ignore unparseable frames
    }
    switch (msg.t) {
      case 'session.ready':
        this.onReady();
        this.emitter.emit('session.ready', msg);
        break;
      case 'audio.ack':
        this.onAck(msg.frameSeq);
        this.emitter.emit('audio.ack', msg);
        break;
      case 'pong':
        this.outstandingPings = 0;
        this.emitter.emit('pong', msg);
        break;
      case 'error':
        this.onError(msg);
        break;
      case 'transcript.partial':
        this.emitter.emit('transcript.partial', msg);
        break;
      case 'transcript.final':
        this.emitter.emit('transcript.final', msg);
        break;
      case 'format.delta':
        this.emitter.emit('format.delta', msg);
        break;
      case 'format.done':
        this.emitter.emit('format.done', msg);
        break;
      case 'usage.update':
        this.emitter.emit('usage.update', msg);
        break;
      default:
        break;
    }
  }

  private onReady(): void {
    this.streaming = true;
    if (this.pendingResume) {
      this.pendingResume = false;
      // Replay every un-acked frame in seq order from lastAcked+1 (§4.4). The ring holds a
      // contiguous run, so the server sees a gapless continuation.
      this.sentSeq = this.lastAckedFrameSeq;
      this.pump();
      // If key-up already happened before the drop, re-announce the last frame so the server
      // can finalize the resumed utterance.
      if (this.audioEndSent && this.activeUtteranceId !== undefined && this.lastFrameSeq !== undefined) {
        this.raw({ t: 'audio.end', utteranceId: this.activeUtteranceId, lastFrameSeq: this.lastFrameSeq });
      }
    }
    this.flushPendingControls();
    this.reconnecting = false;
    this.setState('ready');
  }

  private onAck(frameSeq: number): void {
    if (frameSeq > this.lastAckedFrameSeq) this.lastAckedFrameSeq = frameSeq;
    // Prune from the front: the ring is ascending, so acked frames are a prefix.
    let removed = 0;
    while (removed < this.ring.length && this.ring[removed]!.seq <= frameSeq) removed += 1;
    if (removed > 0) this.ring.splice(0, removed);
    // The socket may have drained as frames were delivered; try to push more.
    this.pump();
  }

  private onError(msg: ErrorMessage): void {
    this.emitter.emit('error', msg);
    switch (msg.code) {
      case 'AUTH_INVALID':
        // Forged/revoked token — no silent retry; the caller must show sign-in.
        this.terminated = true;
        this.clearReconnect();
        this.stopHeartbeat();
        this.streaming = false;
        this.closeConn(1000, 'auth invalid');
        this.setState('closed');
        break;
      case 'AUTH_EXPIRED':
        // Reconnect silently; doConnect always fetches a fresh token (§4.1).
        this.forceReconnect();
        break;
      case 'SESSION_INVALID': {
        // Resume of an unknown/expired session (§4.4). Surface for the offline-buffer path
        // (task 5a) and stop the automatic resume machinery; the caller starts a fresh session.
        this.emitter.emit('sessionInvalid', {
          sessionId: this.sessionId,
          utteranceId: this.activeUtteranceId,
        });
        this.terminated = true;
        this.clearReconnect();
        this.stopHeartbeat();
        this.streaming = false;
        this.pendingResume = false;
        this.resetUtterance();
        this.sessionStartMsg = undefined;
        this.sessionId = undefined;
        this.closeConn(1000, 'session invalid');
        this.setState('closed');
        break;
      }
      default:
        // RATE_LIMITED / QUOTA_EXCEEDED / ASR_* / FORMAT_* / PROTO_ERROR / INTERNAL: surfaced to
        // the caller via the `error` event above (retryAfterMs is on the message). No transport
        // action here — retry policy is the orchestrator's.
        break;
    }
  }

  /** Force an immediate reconnect (fresh token), preserving any active utterance for resume. */
  private forceReconnect(): void {
    const dead = this.conn;
    this.stopHeartbeat();
    this.streaming = false;
    this.conn = undefined;
    if (dead) {
      try {
        dead.close(1000, 'reauth');
      } catch {
        // already closed
      }
    }
    if (this.terminated) return;
    this.setState(this.activeUtteranceId !== undefined ? 'buffering' : 'connecting');
    this.scheduleReconnect();
  }

  // ── Sending / backpressure ───────────────────────────────────────────────────────────────

  /**
   * Push every not-yet-sent buffered frame into the socket, honoring backpressure (§4.4): pause
   * above the high-water mark, resume below the low-water mark. Frames stay in the ring until
   * acked, so a pause never drops audio — it only stalls the socket write.
   */
  private pump(): void {
    const conn = this.conn;
    if (!conn || !this.streaming) return;
    if (this.paused && conn.bufferedAmount() < this.lowWater) this.paused = false;
    if (this.paused) return;
    for (const frame of this.ring) {
      if (frame.seq <= this.sentSeq) continue;
      if (conn.bufferedAmount() > this.highWater) {
        this.paused = true;
        break;
      }
      conn.send(frame.data);
      this.sentSeq = frame.seq;
    }
  }

  private writeControl(msg: ClientMessage): void {
    if (this.conn) {
      this.conn.send(JSON.stringify(msg));
    } else {
      this.pendingControls.push(msg);
    }
  }

  private raw(msg: ClientMessage): void {
    this.conn?.send(JSON.stringify(msg));
  }

  private flushPendingControls(): void {
    if (!this.conn || this.pendingControls.length === 0) return;
    const queued = this.pendingControls;
    this.pendingControls = [];
    for (const msg of queued) this.conn.send(JSON.stringify(msg));
  }

  // ── Utterance bookkeeping ────────────────────────────────────────────────────────────────

  private beginUtterance(utteranceId: UtteranceId): void {
    this.activeUtteranceId = utteranceId;
    this.resetUtterance();
  }

  private resetUtterance(): void {
    this.ring = [];
    this.nextSeq = 0;
    this.sentSeq = -1;
    this.lastAckedFrameSeq = -1;
    this.audioEndSent = false;
    this.lastFrameSeq = undefined;
    this.paused = false;
  }

  // ── Heartbeat (§4.1) ─────────────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.outstandingPings = 0;
    this.heartbeatTimer = setInterval(() => this.onHeartbeat(), this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private onHeartbeat(): void {
    if (!this.conn) return;
    if (this.outstandingPings >= this.maxMissedPongs) {
      // Two pings unanswered → treat the connection as dropped (§4.1).
      this.handleDrop();
      return;
    }
    this.pump(); // opportunistically drain any locally-buffered audio
    this.raw({ t: 'ping', ts: Date.now() });
    this.outstandingPings += 1;
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.emitter.emit('state', next);
  }

  private emitError(err: UndertoneError): void {
    this.emitter.emit('error', toErrorMessage(err));
  }
}
