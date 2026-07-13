// WS gateway — CONTRACTS.md §4 server-side. Owns the /v1/stream upgrade (JWT handshake), the
// per-connection §3 state-machine mirror, binary frame ordering + acks, 60s resumable sessions,
// and drives the §2 utterance pipeline. ASRProvider and Formatter are INJECTED (Tasks 1d/1e build
// the impls); this file never imports a concrete provider.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import {
  FrameDecodeError,
  decodeFrame,
  type ASRProvider,
  type ASRStream,
  type AppContext,
  type ClientMessage,
  type Formatter,
  type ServerMessage,
  type SessionId,
  type UtteranceId,
} from '@undertone/shared';
import type { Plan } from '../routes/session-token';
import { TokenExpiredError, verifySessionToken } from './jwt';
import { PermissiveRateLimiter, type RateLimiter } from './rate-limiter';
import { SessionStore } from './session-store';
import { SessionStateMachine } from './state-machine';
import { runUtterancePipeline, wireError } from './pipeline';

/** Frames acked every 25 (~500ms of audio) — CONTRACTS.md §4.3 / DECISIONS D-006. */
const ACK_EVERY = 25;
/** After `audio.end`, finalize once `lastFrameSeq` is in OR this elapses — CONTRACTS.md §4.3. */
const AUDIO_END_GRACE_MS = 250;

/** WS close codes used by the gateway. */
const CLOSE = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 1002,
  INTERNAL: 1011,
  /** Auth failure at/after upgrade — CONTRACTS.md §4.1 ("Expired/invalid → 4401"). */
  AUTH: 4401,
} as const;

/** Injected collaborators — providers come from Tasks 1d/1e; store/limiter default in-process. */
export interface GatewayDeps {
  asrProvider: ASRProvider;
  formatter: Formatter;
  rateLimiter?: RateLimiter;
  sessionStore?: SessionStore;
  /** TTFT ceiling override (tests lower it to stay fast); defaults to the §8 contract value. */
  ttftTimeoutMs?: number;
  /** Timing-mark clock; defaults to Date.now. Injected for deterministic tests. */
  now?: () => number;
}

interface BoundUser {
  userId: string;
  plan: Plan;
}

interface ActiveUtterance {
  utteranceId: UtteranceId;
  appContext: AppContext;
  stream: ASRStream;
  /** Highest in-order frameSeq accepted; -1 before any frame. */
  highWaterSeq: number;
  /** Set once the finalize path has been kicked; later tail frames are ignored. */
  finalizeStarted: boolean;
  /** Pending `audio.end` gate: fire when highWaterSeq reaches lastFrameSeq or the grace timer. */
  frameWaiter?: { lastFrameSeq: number; fire: () => void };
}

/** Register @fastify/websocket and the /v1/stream route. */
export function registerWsGateway(app: FastifyInstance, deps: GatewayDeps): void {
  const resolved: Required<Omit<GatewayDeps, 'ttftTimeoutMs'>> &
    Pick<GatewayDeps, 'ttftTimeoutMs'> = {
    asrProvider: deps.asrProvider,
    formatter: deps.formatter,
    rateLimiter: deps.rateLimiter ?? new PermissiveRateLimiter(),
    sessionStore: deps.sessionStore ?? new SessionStore(),
    now: deps.now ?? Date.now,
    ttftTimeoutMs: deps.ttftTimeoutMs,
  };
  // Encapsulated so the websocket plugin decorates before the route is defined.
  app.register(async (scope) => {
    await scope.register(websocket);
    scope.get('/v1/stream', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
      const token = (req.query as { token?: string }).token ?? '';
      new Connection(socket, resolved).begin(token);
    });
  });
}

/** One WS connection's lifecycle + state. Messages are processed on a serial queue for ordering. */
class Connection {
  private readonly machine = new SessionStateMachine();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private user: BoundUser | undefined;
  private sessionId: SessionId | undefined;
  private locale = 'en-US';
  private utterance: ActiveUtterance | undefined;

  constructor(
    private readonly socket: WebSocket,
    private readonly deps: Required<Omit<GatewayDeps, 'ttftTimeoutMs'>> &
      Pick<GatewayDeps, 'ttftTimeoutMs'>,
  ) {
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      this.enqueue(() => this.onMessage(data, isBinary));
    });
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }

  /** First queued task authenticates; all message tasks queue behind it (§4.1). */
  begin(token: string): void {
    this.enqueue(() => this.authenticate(token));
  }

  private enqueue(task: () => Promise<void> | void): void {
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      await task();
    });
    // Swallow-and-map: an unexpected throw becomes an INTERNAL frame, never an unhandled rejection.
    this.queue = this.queue.catch((err: unknown) => this.onInternal(err));
  }

  private async authenticate(token: string): Promise<void> {
    try {
      const claims = await verifySessionToken(token);
      this.user = { userId: claims.sub, plan: claims.plan };
    } catch (err) {
      // Both expired and invalid close 4401 (§4.1); reason distinguishes for client telemetry.
      const reason = err instanceof TokenExpiredError ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
      this.hardClose(CLOSE.AUTH, reason);
    }
  }

  // ── Message dispatch ──────────────────────────────────────────────────────────────────────
  private async onMessage(data: Buffer, isBinary: boolean): Promise<void> {
    if (!this.user) {
      // A message before auth completed (or after failure) is a protocol violation.
      this.protoClose('message before authentication');
      return;
    }
    if (isBinary) {
      this.onAudioFrame(data);
      return;
    }
    const msg = this.parseControl(data);
    if (!msg) {
      this.protoClose('malformed control message');
      return;
    }
    await this.onControl(msg);
  }

  private parseControl(data: Buffer): ClientMessage | null {
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString('utf8'));
    } catch {
      return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;
    const t = (raw as { t?: unknown }).t;
    const obj = raw as Record<string, unknown>;
    switch (t) {
      case 'session.start':
        return isAppContext(obj.appContext) &&
          typeof obj.sessionId === 'string' &&
          typeof obj.locale === 'string'
          ? { t, sessionId: obj.sessionId, appContext: obj.appContext, locale: obj.locale }
          : null;
      case 'utterance.start':
        return typeof obj.utteranceId === 'number' && isAppContext(obj.appContext)
          ? { t, utteranceId: obj.utteranceId, appContext: obj.appContext }
          : null;
      case 'audio.end':
        return typeof obj.utteranceId === 'number' && typeof obj.lastFrameSeq === 'number'
          ? { t, utteranceId: obj.utteranceId, lastFrameSeq: obj.lastFrameSeq }
          : null;
      case 'session.resume':
        return typeof obj.sessionId === 'string' &&
          typeof obj.utteranceId === 'number' &&
          typeof obj.lastAckedFrameSeq === 'number'
          ? {
              t,
              sessionId: obj.sessionId,
              utteranceId: obj.utteranceId,
              lastAckedFrameSeq: obj.lastAckedFrameSeq,
            }
          : null;
      case 'ping':
        return typeof obj.ts === 'number' ? { t, ts: obj.ts } : null;
      default:
        return null;
    }
  }

  private async onControl(msg: ClientMessage): Promise<void> {
    // Per-message rate check (§8 RATE_LIMITED); ping is exempt (heartbeat, §4.1).
    if (msg.t !== 'ping') {
      const decision = this.deps.rateLimiter.checkMessage(this.user!.userId);
      if (!decision.ok) {
        this.send(wireError('RATE_LIMITED', undefined, decision.retryAfterMs));
        return;
      }
    }
    switch (msg.t) {
      case 'session.start':
        return this.onSessionStart(msg.sessionId, msg.appContext, msg.locale);
      case 'utterance.start':
        return this.onUtteranceStart(msg.utteranceId, msg.appContext);
      case 'audio.end':
        return this.onAudioEnd(msg.utteranceId, msg.lastFrameSeq);
      case 'session.resume':
        return this.onResume(msg.sessionId, msg.utteranceId, msg.lastAckedFrameSeq);
      case 'ping':
        this.send({ t: 'pong', ts: msg.ts });
        return;
    }
  }

  private onSessionStart(sessionId: SessionId, appContext: AppContext, locale: string): void {
    if (this.sessionId) {
      this.protoClose('session.start after session already started');
      return;
    }
    this.sessionId = sessionId;
    this.locale = locale;
    this.deps.sessionStore.create({
      sessionId,
      userId: this.user!.userId,
      plan: this.user!.plan,
      locale,
      appContext,
    });
    this.send({ t: 'session.ready', sessionId });
  }

  private async onUtteranceStart(utteranceId: UtteranceId, appContext: AppContext): Promise<void> {
    if (!this.sessionId) {
      this.protoClose('utterance.start before session.start');
      return;
    }
    const outcome = this.machine.dispatch('utterance.start');
    if (outcome.kind === 'ignored') return; // key-down while busy → ignored (§3, no re-entrancy)
    // (utterance.start never yields 'illegal'.)
    let stream: ASRStream;
    try {
      stream = await this.deps.asrProvider.startStream({
        sampleRate: 16000,
        encoding: 'linear16',
        channels: 1,
        locale: this.locale,
        keywords: [],
      });
    } catch {
      this.machine.toError();
      this.send(wireError('ASR_UNAVAILABLE', utteranceId));
      this.machine.reset('idle');
      return;
    }
    stream.onPartial((text) => this.send({ t: 'transcript.partial', utteranceId, text }));
    stream.onError(() => {
      if (this.closed) return;
      this.send(wireError('ASR_UNAVAILABLE', utteranceId));
    });
    this.utterance = {
      utteranceId,
      appContext,
      stream,
      highWaterSeq: -1,
      finalizeStarted: false,
    };
    const record = this.deps.sessionStore.get(this.sessionId);
    if (record) record.utterance = { utteranceId, appContext, highWaterSeq: -1 };
  }

  private onAudioFrame(data: Buffer): void {
    let frame;
    try {
      frame = decodeFrame(new Uint8Array(data));
    } catch (err) {
      if (err instanceof FrameDecodeError) {
        this.protoClose(err.message);
        return;
      }
      throw err;
    }
    const u = this.utterance;
    if (!u || frame.utteranceId !== u.utteranceId) {
      this.protoClose('audio frame with no matching active utterance');
      return;
    }
    if (u.finalizeStarted) return; // tail frame after finalize kicked → ignore
    const decision = this.deps.rateLimiter.checkFrame(this.user!.userId);
    if (!decision.ok) {
      this.send(wireError('RATE_LIMITED', u.utteranceId, decision.retryAfterMs));
      return;
    }
    const expected = u.highWaterSeq + 1;
    if (frame.frameSeq !== expected) {
      // Out-of-order (dup or gap): drop + re-ack the high-water mark (§4.4).
      if (u.highWaterSeq >= 0) {
        this.send({ t: 'audio.ack', utteranceId: u.utteranceId, frameSeq: u.highWaterSeq });
      }
      return;
    }
    if (u.highWaterSeq === -1) this.machine.dispatch('audio.frame'); // arming → listening
    u.stream.sendAudio(frame.payload);
    u.highWaterSeq = expected;
    const record = this.sessionId ? this.deps.sessionStore.get(this.sessionId) : undefined;
    if (record?.utterance) record.utterance.highWaterSeq = expected;
    if ((expected + 1) % ACK_EVERY === 0) {
      this.send({ t: 'audio.ack', utteranceId: u.utteranceId, frameSeq: expected });
    }
    if (u.frameWaiter && u.highWaterSeq >= u.frameWaiter.lastFrameSeq) u.frameWaiter.fire();
  }

  private onAudioEnd(utteranceId: UtteranceId, lastFrameSeq: number): void {
    const u = this.utterance;
    if (!u || u.utteranceId !== utteranceId) {
      this.protoClose('audio.end for an unknown utterance');
      return;
    }
    const outcome = this.machine.dispatch('audio.end'); // listening|arming → finalizing
    if (outcome.kind === 'illegal') {
      this.protoClose('audio.end in an illegal state');
      return;
    }
    const keyupMs = this.deps.now(); // §9 t_keyup ≈ audio.end receipt (documented approximation)
    const fire = (): void => {
      if (u.finalizeStarted) return;
      u.finalizeStarted = true;
      u.frameWaiter = undefined;
      void this.runPipeline(u, keyupMs);
    };
    if (u.highWaterSeq >= lastFrameSeq) {
      fire();
      return;
    }
    // Wait for the tail frames or the grace window — whichever comes first. Non-blocking: tail
    // frames keep flowing through the queue and trip the waiter.
    const timer = setTimeout(fire, AUDIO_END_GRACE_MS);
    u.frameWaiter = {
      lastFrameSeq,
      fire: () => {
        clearTimeout(timer);
        fire();
      },
    };
  }

  private async runPipeline(u: ActiveUtterance, keyupMs: number): Promise<void> {
    await runUtterancePipeline({
      utteranceId: u.utteranceId,
      asrStream: u.stream,
      formatter: this.deps.formatter,
      appContext: u.appContext,
      locale: this.locale,
      send: (m) => this.send(m),
      machine: this.machine,
      keyupMs,
      now: this.deps.now,
      ...(this.deps.ttftTimeoutMs !== undefined ? { ttftTimeoutMs: this.deps.ttftTimeoutMs } : {}),
    });
    // Utterance complete; the session stays resumable until transport loss + 60s.
    if (this.utterance === u) this.utterance = undefined;
    const record = this.sessionId ? this.deps.sessionStore.get(this.sessionId) : undefined;
    if (record) record.utterance = undefined;
  }

  private async onResume(
    sessionId: SessionId,
    utteranceId: UtteranceId,
    _lastAckedFrameSeq: number,
  ): Promise<void> {
    const record = this.deps.sessionStore.resume(sessionId);
    if (!record || record.userId !== this.user!.userId) {
      // Unknown/expired session, or a token that doesn't own it → SESSION_INVALID (§8, §4.4).
      this.send(wireError('SESSION_INVALID', utteranceId));
      return;
    }
    this.sessionId = record.sessionId;
    this.locale = record.locale;
    if (record.utterance && record.utterance.utteranceId === utteranceId) {
      const saved = record.utterance;
      let stream: ASRStream;
      try {
        stream = await this.deps.asrProvider.startStream({
          sampleRate: 16000,
          encoding: 'linear16',
          channels: 1,
          locale: this.locale,
          keywords: [],
        });
      } catch {
        this.machine.toError();
        this.send(wireError('ASR_UNAVAILABLE', utteranceId));
        this.machine.reset('idle');
        return;
      }
      stream.onPartial((text) => this.send({ t: 'transcript.partial', utteranceId, text }));
      stream.onError(() => {
        if (this.closed) return;
        this.send(wireError('ASR_UNAVAILABLE', utteranceId));
      });
      this.utterance = {
        utteranceId,
        appContext: saved.appContext,
        stream,
        highWaterSeq: saved.highWaterSeq,
        finalizeStarted: false,
      };
      this.machine.reset('listening');
    }
    this.send({ t: 'session.ready', sessionId: record.sessionId });
    // §4.4: the server's lastReceivedFrameSeq is implied by the next ack; emit it now so the
    // client replays from lastAckedFrameSeq + 1.
    if (this.utterance && this.utterance.highWaterSeq >= 0) {
      this.send({
        t: 'audio.ack',
        utteranceId: this.utterance.utteranceId,
        frameSeq: this.utterance.highWaterSeq,
      });
    }
  }

  // ── Socket + error helpers ──────────────────────────────────────────────────────────────────
  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    // Keep the session resumable for 60s (§4.4). GC'd lazily on a later resume attempt.
    if (this.sessionId) this.deps.sessionStore.markDisconnected(this.sessionId);
    if (this.utterance) {
      try {
        this.utterance.stream.close();
      } catch {
        /* idempotent close; ignore */
      }
    }
  }

  private onInternal(err: unknown): void {
    if (this.closed) return;
    const message = err instanceof Error ? err.message : String(err);
    this.send({ t: 'error', code: 'INTERNAL', message, retryable: false });
    this.hardClose(CLOSE.INTERNAL, 'INTERNAL');
  }

  private protoClose(reason: string): void {
    if (this.closed) return;
    this.send(wireError('PROTO_ERROR'));
    this.hardClose(CLOSE.PROTOCOL_ERROR, reason);
  }

  private hardClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId) this.deps.sessionStore.markDisconnected(this.sessionId);
    try {
      this.socket.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  private send(msg: ServerMessage): void {
    if (this.closed) return;
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }
}

/** Structural guard for the wire `AppContext` (§1). */
function isAppContext(value: unknown): value is AppContext {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.bundleId === 'string' &&
    typeof v.appName === 'string' &&
    typeof v.windowTitle === 'string' &&
    typeof v.register === 'string'
  );
}
