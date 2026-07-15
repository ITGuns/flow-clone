// The desktop session orchestrator — the main-process brain that ties hotkey → audio → WS →
// formatting events → injection into the CONTRACTS §3 state machine, emitting a HudState per the
// frozen ipc-contract.ts on every change. This is the client half of the product's spine
// (ARCHITECTURE §2).
//
// State machine (CONTRACTS §3), with the HudPhase each internal state maps to (ipc-contract.ts):
//
//   idle       → hidden   (or a transient 'done' HUD after a successful inject)
//   arming     → listening   key-down: capture appContext, session/utterance.start, start capture
//   listening  → listening   first audio frame accepted; VAD `level` drives the meter
//   finalizing → thinking    key-up: capture.stop() flushes the tail frame, then audio.end
//   formatting → thinking    transcript.final received
//   injecting  → thinking    format deltas / done → inject (streamed for long utterances)
//   error      → error       any state on a §8 error; auto-dismiss → idle/hidden
//   buffering  → error (recoverable)  transport loss during capture; hand-off to the offline seam
//
// Key-down during any non-idle state is ignored (CONTRACTS §3 — no re-entrancy in v1). After a
// successful inject the internal state is already `idle` (HUD shows 'done'), so a new key-down
// re-arms immediately; an `error`/`buffering` display blocks re-arm until it auto-dismisses.

import {
  buildAppContext,
  type AppContext,
  type ErrorCode,
  type ErrorMessage,
  type FormatDeltaMessage,
  type FormatDoneMessage,
  type SessionId,
  type TranscriptFinalMessage,
  type UtteranceId,
} from '@undertone/shared';
import type { ConnectionState, SessionInvalidEvent } from '../../ws';
import type { InjectResult } from '../../native';
import { HUD_DONE_DISMISS_MS, type HudState } from '../../ipc-contract';
import {
  systemClock,
  type BufferedUtterance,
  type BufferSink,
  type CapturePort,
  type CaptureVad,
  type Clock,
  type SessionOrchestratorPorts,
} from './ports';

export interface SessionOrchestratorOptions {
  /** Push-to-talk accelerator registered with the hotkey manager. */
  accelerator: string;
  /** BCP-47 locale for `session.start` / formatting. Default 'en-US'. */
  locale?: string;
  /**
   * Whitespace-word count above which formatting output is injected as it streams, at sentence
   * boundaries (guide §4.2 / ARCHITECTURE hop 6). At or below it, a single inject on format.done.
   * Default 15.
   */
  wordThreshold?: number;
  /** How long the 'done' HUD lingers before auto-dismiss to 'hidden' (§3). Default 800ms. */
  doneDismissMs?: number;
  /** How long an 'error'/'buffering' HUD lingers before auto-dismiss to idle. Default 800ms. */
  errorDismissMs?: number;
  /** Max HUD `level` pushes per second while listening (VAD is ~50/s). Default 30. */
  maxLevelPushesPerSec?: number;
  /** Client-generated per-connection session id (UUIDv4). Default `crypto.randomUUID`. */
  createSessionId?: () => SessionId;
  /** Injectable time source. Default {@link systemClock}. */
  clock?: Clock;
  /** Optional offline-buffer seam (task 5a). Also surfaced via {@link SessionOrchestrator.onBuffered}. */
  bufferSink?: BufferSink;
}

type OrchestratorState =
  | 'idle'
  | 'arming'
  | 'listening'
  | 'finalizing'
  | 'formatting'
  | 'injecting'
  | 'error'
  | 'buffering';

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_WORD_THRESHOLD = 15;
const DEFAULT_MAX_LEVEL_PUSHES_PER_SEC = 30;
const U16_MAX = 0xffff; // 65535 — utteranceId is u16 (CONTRACTS §1); wrap keeps it in range.

// §8 groups the orchestrator maps error codes into.
// Raw-fallback: server ALSO sends a `format.done` carrying the raw transcript — inject it, then
// flag the result 'unformatted' in the HUD (error flavor). Losing formatting is annoying; losing
// the user's words is fatal (§8).
const RAW_FALLBACK_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'FORMAT_UNAVAILABLE',
  'FORMAT_TIMEOUT',
  'QUOTA_EXCEEDED',
]);
// Offline-buffer path: hand the utterance to the seam, HUD shows a recoverable error (§8).
const BUFFERING_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'OFFLINE_BUFFERED',
  'ASR_UNAVAILABLE',
  'ASR_TIMEOUT',
  'SESSION_INVALID',
]);
// Handled by the WsClient / leave the HUD unchanged (§8): AUTH_EXPIRED reconnects silently,
// RATE_LIMITED backs off with the HUD unchanged.
const SILENT_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['AUTH_EXPIRED', 'RATE_LIMITED']);

/** A sentence boundary is a `.`/`!`/`?` followed by whitespace, or a newline (guide §4.2). */
const SENTENCE_BOUNDARY = /[.!?]\s|\n/g;

/** Whitespace word count — the same rule as the metering unit (CONTRACTS §1). */
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Absolute index one past the LAST sentence boundary at or after `from` in `text`, or `from` when
 * there is none. The returned prefix therefore ends cleanly on a sentence (trailing delimiter +
 * whitespace/newline included), so streamed chunks read naturally.
 */
function lastSentenceBoundaryEnd(text: string, from: number): number {
  const region = text.slice(from);
  let last = -1;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(region)) !== null) {
    last = match.index + match[0].length;
  }
  return last === -1 ? from : from + last;
}

export class SessionOrchestrator {
  private readonly ports: SessionOrchestratorPorts;
  private readonly accelerator: string;
  private readonly locale: string;
  private readonly wordThreshold: number;
  private readonly doneDismissMs: number;
  private readonly errorDismissMs: number;
  private readonly levelMinIntervalMs: number;
  private readonly createSessionId: () => SessionId;
  private readonly clock: Clock;
  private readonly bufferSink: BufferSink | undefined;

  private readonly bufferedListeners = new Set<(info: BufferedUtterance) => void>();
  private readonly wsUnsubs: Array<() => void> = [];
  private unregisterHotkey: (() => void) | undefined;

  private state: OrchestratorState = 'idle';

  // ── Per-connection ──
  private sessionStarted = false;
  private sessionId: SessionId | undefined;
  private utteranceCounter = 0; // u16 monotonic per session; first utterance is 1.

  // ── Per-utterance ──
  private activeUtteranceId: UtteranceId | undefined;
  private currentAppContext: AppContext | undefined;
  private capture: CapturePort | undefined;
  private captureUnsubs: Array<() => void> = [];
  private captureStarted = false;
  private releaseRequested = false; // key-up arrived while still arming (before capture started)
  private framesSent = 0; // accepted frames == next WS frameSeq; lastFrameSeq = framesSent − 1
  private audioEndSent = false;

  // ── Formatting / injection ──
  private accumulated = ''; // concatenation of format deltas seen so far
  private injectedChars = 0; // length of the prefix already handed to the injector
  private streaming = false; // crossed the word threshold → inject at sentence boundaries
  private formatDoneReceived = false;
  private pendingFallbackCode: ErrorCode | undefined; // raw-fallback flavor (FORMAT_* / QUOTA)
  private readonly injectQueue: string[] = [];
  private draining = false;

  // ── HUD ──
  private lastHud: HudState = { phase: 'hidden', level: 0 };
  private lastLevelEmit = Number.NEGATIVE_INFINITY;
  private dismissCancel: (() => void) | undefined;
  private dismissGen = 0;

  constructor(ports: SessionOrchestratorPorts, options: SessionOrchestratorOptions) {
    this.ports = ports;
    this.accelerator = options.accelerator;
    this.locale = options.locale ?? DEFAULT_LOCALE;
    this.wordThreshold = options.wordThreshold ?? DEFAULT_WORD_THRESHOLD;
    this.doneDismissMs = options.doneDismissMs ?? HUD_DONE_DISMISS_MS;
    this.errorDismissMs = options.errorDismissMs ?? HUD_DONE_DISMISS_MS;
    const maxLevel = options.maxLevelPushesPerSec ?? DEFAULT_MAX_LEVEL_PUSHES_PER_SEC;
    this.levelMinIntervalMs = 1000 / maxLevel;
    this.createSessionId = options.createSessionId ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? systemClock;
    this.bufferSink = options.bufferSink;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────

  /** Register the hotkey, subscribe to WS events, and open the connection. */
  async start(): Promise<void> {
    this.unregisterHotkey = this.ports.hotkey.register(this.accelerator, (phase) =>
      this.onHotkey(phase),
    );
    this.subscribeWs();
    await this.ports.ws.connect();
  }

  /** Tear everything down. Idempotent-ish; safe to call once at shutdown. */
  dispose(): void {
    this.unregisterHotkey?.();
    this.unregisterHotkey = undefined;
    for (const unsub of this.wsUnsubs) unsub();
    this.wsUnsubs.length = 0;
    this.cancelDismiss();
    this.teardownCapture(true);
    this.ports.ws.close();
  }

  /** Current internal state — for the composition/gate and assertions. */
  getState(): OrchestratorState {
    return this.state;
  }

  /** The last HudState pushed to the sink. */
  getHudState(): HudState {
    return this.lastHud;
  }

  /** Subscribe to offline-buffer hand-offs (task 5a seam). Returns an unsubscribe fn. */
  onBuffered(listener: (info: BufferedUtterance) => void): () => void {
    this.bufferedListeners.add(listener);
    return () => this.bufferedListeners.delete(listener);
  }

  // ── Hotkey ─────────────────────────────────────────────────────────────────────────────────

  private onHotkey(phase: 'down' | 'up'): void {
    if (phase === 'down') this.onKeyDown();
    else this.onKeyUp();
  }

  private onKeyDown(): void {
    if (this.state !== 'idle') return; // key-down during any non-idle state is ignored (§3)
    void this.arm();
  }

  private onKeyUp(): void {
    if (this.state === 'arming') {
      // A tap: released before the first frame. Finalize now if capture is live, else remember it
      // and finalize the moment arming finishes wiring capture.
      if (this.captureStarted) void this.finalize();
      else this.releaseRequested = true;
      return;
    }
    if (this.state === 'listening') {
      void this.finalize();
      return;
    }
    // Any other state (idle / finalizing / formatting / injecting / error / buffering): ignore.
    // This is what makes a double key-up a no-op.
  }

  // ── arming ─────────────────────────────────────────────────────────────────────────────────

  private async arm(): Promise<void> {
    this.cancelDismiss(); // supersede any lingering 'done'/'error' HUD from the previous utterance
    this.endUtterance(false); // drop any prior capture handle (already stopped) + reset data
    this.state = 'arming';
    this.emitHud({ phase: 'listening', level: 0 });

    this.utteranceCounter = this.utteranceCounter >= U16_MAX ? 1 : this.utteranceCounter + 1;
    const uid = this.utteranceCounter;
    this.activeUtteranceId = uid;

    let appContext: AppContext;
    try {
      appContext = buildAppContext(await this.ports.appDetect.getActiveApp());
    } catch {
      this.enterError('INTERNAL', false);
      return;
    }
    if (this.activeUtteranceId !== uid) return; // superseded (should not happen; defensive)
    this.currentAppContext = appContext;

    this.ensureSessionStarted(appContext);
    this.ports.ws.sendControl({ t: 'utterance.start', utteranceId: uid, appContext });

    const capture = this.ports.createCapture();
    this.capture = capture;
    this.captureUnsubs = [
      capture.onFrame((frame) => this.handleFrame(uid, frame)),
      capture.onVad((result) => this.handleVad(uid, result)),
      capture.onError(() => this.handleCaptureError(uid)),
    ];

    try {
      await capture.start();
    } catch {
      this.enterError('INTERNAL', false);
      return;
    }
    if (this.activeUtteranceId !== uid) return;
    this.captureStarted = true;

    if (this.releaseRequested) {
      this.releaseRequested = false;
      void this.finalize();
    }
  }

  private ensureSessionStarted(appContext: AppContext): void {
    if (this.sessionStarted) return;
    this.sessionId = this.createSessionId();
    this.ports.ws.sendControl({
      t: 'session.start',
      sessionId: this.sessionId,
      appContext,
      locale: this.locale,
    });
    this.sessionStarted = true;
  }

  // ── capture events ─────────────────────────────────────────────────────────────────────────

  private handleFrame(uid: UtteranceId, frame: Uint8Array): void {
    if (uid !== this.activeUtteranceId || this.audioEndSent) return;
    if (this.state === 'arming') this.state = 'listening'; // arming → listening on first frame
    else if (this.state !== 'listening' && this.state !== 'finalizing') return;
    // The WsClient owns frameSeq (§4.2) and the replay ring; it assigns 0,1,2,… as we hand it
    // payloads, in lockstep with the capture stream. We track only the count of ACCEPTED frames so
    // audio.end can name the last seq. A rejected frame (ring full) does not consume a seq — the
    // client emits OFFLINE_BUFFERED, which routes us to `buffering`.
    const accepted = this.ports.ws.sendFrame(uid, frame);
    if (accepted) this.framesSent += 1;
  }

  private handleVad(uid: UtteranceId, result: CaptureVad): void {
    if (uid !== this.activeUtteranceId || this.state !== 'listening') return;
    const now = this.clock.now();
    if (now - this.lastLevelEmit < this.levelMinIntervalMs) return; // throttle to ≤ N pushes/sec
    this.lastLevelEmit = now;
    this.emitHud({ phase: 'listening', level: result.level });
  }

  private handleCaptureError(uid: UtteranceId): void {
    if (uid !== this.activeUtteranceId) return;
    // A client-local capture pipeline failure. No §8 code fits; surface as INTERNAL.
    this.enterError('INTERNAL', false);
  }

  // ── finalizing ─────────────────────────────────────────────────────────────────────────────

  private async finalize(): Promise<void> {
    if (this.state !== 'arming' && this.state !== 'listening') return;
    const uid = this.activeUtteranceId;
    if (uid === undefined) return;
    this.state = 'finalizing';
    this.emitHud({ phase: 'thinking', level: 0 });

    if (this.captureStarted && this.capture) {
      // stop() flushes the trailing partial frame (via onFrame, still in 'finalizing' and before
      // audioEndSent) then resolves — so framesSent includes the tail before we name lastFrameSeq.
      try {
        await this.capture.stop();
      } catch {
        // device already released — nothing left to flush.
      }
    }
    if (this.activeUtteranceId !== uid) return; // superseded by an error while stopping
    this.audioEndSent = true;
    this.ports.ws.sendControl({ t: 'audio.end', utteranceId: uid, lastFrameSeq: this.framesSent - 1 });
  }

  // ── WS server events ───────────────────────────────────────────────────────────────────────

  private subscribeWs(): void {
    const { ws } = this.ports;
    this.wsUnsubs.push(
      ws.on('transcript.final', (msg) => this.handleTranscriptFinal(msg)),
      ws.on('format.delta', (msg) => this.handleFormatDelta(msg)),
      ws.on('format.done', (msg) => this.handleFormatDone(msg)),
      ws.on('error', (msg) => this.handleWsError(msg)),
      ws.on('state', (s) => this.handleWsState(s)),
      ws.on('sessionInvalid', (evt) => this.handleSessionInvalid(evt)),
    );
  }

  private handleTranscriptFinal(msg: TranscriptFinalMessage): void {
    if (msg.utteranceId !== this.activeUtteranceId || this.state !== 'finalizing') return;
    if (msg.text.trim().length === 0) {
      // Empty transcript (the user held the key over silence): nothing to format or inject.
      this.finishIdleSilent();
      return;
    }
    this.state = 'formatting';
    // HUD stays 'thinking' (finalizing and formatting both map to 'thinking') — no emit.
  }

  private handleFormatDelta(msg: FormatDeltaMessage): void {
    if (msg.utteranceId !== this.activeUtteranceId) return;
    if (this.state !== 'formatting' && this.state !== 'injecting') return;
    if (this.state === 'formatting') this.state = 'injecting'; // → injecting on first delta (long)
    this.accumulated += msg.text;
    this.maybeStreamInject();
  }

  private handleFormatDone(msg: FormatDoneMessage): void {
    if (msg.utteranceId !== this.activeUtteranceId) return;
    if (this.state !== 'formatting' && this.state !== 'injecting') return;
    if (this.state === 'formatting') this.state = 'injecting'; // → injecting on format.done (short)

    // format.done.text is the authoritative final text (concatenation of all deltas, CONTRACTS
    // §4.3). Inject whatever has not been streamed yet as the remainder.
    const finalText = msg.text;
    this.formatDoneReceived = true;
    const remainder = finalText.slice(this.injectedChars);
    this.injectedChars = finalText.length;
    if (remainder.length > 0) this.injectQueue.push(remainder);
    void this.drainInjectQueue();
  }

  /**
   * Decide whether to stream, and if so enqueue every newly-completed sentence. Under the word
   * threshold we wait (single inject on done). Once over it, we inject the maximal prefix that
   * ends on a sentence boundary; text with no boundary yet waits for more deltas or for done
   * (→ single inject) — the documented no-boundary edge case.
   */
  private maybeStreamInject(): void {
    if (this.pendingFallbackCode !== undefined) return; // raw-fallback: single inject on done
    if (!this.streaming) {
      if (wordCount(this.accumulated) > this.wordThreshold) this.streaming = true;
      else return;
    }
    const boundary = lastSentenceBoundaryEnd(this.accumulated, this.injectedChars);
    if (boundary > this.injectedChars) {
      const chunk = this.accumulated.slice(this.injectedChars, boundary);
      this.injectedChars = boundary;
      this.injectQueue.push(chunk);
      void this.drainInjectQueue();
    }
  }

  /**
   * Serialize injection so sentence chunks land at the cursor in order. Re-entrant-safe: new
   * chunks (later deltas) and the final remainder (format.done) are picked up by the running loop.
   */
  private async drainInjectQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.injectQueue.length > 0 && this.state === 'injecting') {
      const chunk = this.injectQueue.shift() as string;
      let result: InjectResult;
      try {
        result = await this.ports.inject.inject(chunk);
      } catch {
        this.draining = false;
        this.enterError('INJECT_FAILED', false);
        return;
      }
      if (!result.ok) {
        // The native injector's clipboard fallback already returns ok:true; a genuine ok:false is
        // a hard failure. We have no clipboard access here (§8) — surface the error honestly.
        this.draining = false;
        this.enterError('INJECT_FAILED', false);
        return;
      }
    }
    this.draining = false;
    if (this.formatDoneReceived && this.state === 'injecting' && this.injectQueue.length === 0) {
      this.finishInjection();
    }
  }

  private finishInjection(): void {
    if (this.pendingFallbackCode !== undefined) {
      // Raw transcript was injected successfully, but it is unformatted — flag it honestly (§8).
      const code = this.pendingFallbackCode;
      this.enterError(code, false);
      return;
    }
    this.endUtterance(false); // capture already stopped in finalize
    this.state = 'idle';
    this.emitHud({ phase: 'done', level: 0 });
    this.scheduleDismiss(this.doneDismissMs);
  }

  // ── errors / buffering ─────────────────────────────────────────────────────────────────────

  private handleWsError(msg: ErrorMessage): void {
    const code = msg.code;
    if (RAW_FALLBACK_CODES.has(code)) {
      // The accompanying raw format.done does the injection; just remember the flavor to show.
      if (this.state === 'finalizing' || this.state === 'formatting' || this.state === 'injecting') {
        this.pendingFallbackCode = code;
      }
      return;
    }
    if (BUFFERING_CODES.has(code)) {
      if (this.isActiveFlow()) this.enterBuffering(code);
      return;
    }
    if (SILENT_CODES.has(code)) return; // handled by the WsClient / HUD unchanged (§8)
    // Hard errors: AUTH_INVALID / PROTO_ERROR / INTERNAL — only meaningful mid-flow.
    if (this.isActiveFlow()) this.enterError(code, msg.retryable);
  }

  private handleWsState(next: ConnectionState): void {
    // A mid-capture transport loss surfaces on the WsClient as `buffering` (ws/types.ts). Mirror
    // it into the §3 `buffering` state and hand the utterance to the offline seam.
    if (next === 'buffering' && this.isCapturing()) {
      this.enterBuffering('OFFLINE_BUFFERED');
    }
  }

  private handleSessionInvalid(_evt: SessionInvalidEvent): void {
    // Resume rejected (§4.4 / §8). The WsClient tore the session down; re-establish next arm.
    this.sessionStarted = false;
    this.sessionId = undefined;
    if (this.isActiveFlow()) this.enterBuffering('SESSION_INVALID');
  }

  private enterError(code: ErrorCode, recoverable: boolean): void {
    this.endUtterance(true);
    this.state = 'error';
    this.emitHud({ phase: 'error', level: 0, errorCode: code, recoverable });
    this.scheduleDismiss(this.errorDismissMs);
  }

  private enterBuffering(code: ErrorCode): void {
    const info: BufferedUtterance | undefined =
      this.activeUtteranceId !== undefined && this.currentAppContext !== undefined
        ? { utteranceId: this.activeUtteranceId, appContext: this.currentAppContext, reason: code }
        : undefined;
    this.endUtterance(true);
    this.state = 'buffering';
    this.emitHud({ phase: 'error', level: 0, errorCode: code, recoverable: true });
    if (info) this.emitBuffered(info); // seam: task 5a persists + retries; we never lose the words
    this.scheduleDismiss(this.errorDismissMs);
  }

  private finishIdleSilent(): void {
    this.endUtterance(false); // capture already stopped in finalize
    this.state = 'idle';
    this.emitHud({ phase: 'hidden', level: 0 }); // graceful idle: no injection, no 'done' flash
  }

  // ── HUD ────────────────────────────────────────────────────────────────────────────────────

  private emitHud(next: HudState): void {
    if (
      next.phase === this.lastHud.phase &&
      next.level === this.lastHud.level &&
      next.errorCode === this.lastHud.errorCode &&
      next.recoverable === this.lastHud.recoverable
    ) {
      return; // idempotent: never push an identical state
    }
    this.lastHud = next;
    this.ports.hud(next);
  }

  private scheduleDismiss(delayMs: number): void {
    this.cancelDismiss();
    const gen = this.dismissGen;
    this.dismissCancel = this.clock.schedule(() => {
      if (gen !== this.dismissGen) return; // superseded by a new utterance
      if (this.state === 'error' || this.state === 'buffering') this.state = 'idle';
      this.emitHud({ phase: 'hidden', level: 0 });
    }, delayMs);
  }

  private cancelDismiss(): void {
    this.dismissCancel?.();
    this.dismissCancel = undefined;
    this.dismissGen += 1;
  }

  // ── seam / utterance bookkeeping ───────────────────────────────────────────────────────────

  private emitBuffered(info: BufferedUtterance): void {
    for (const listener of this.bufferedListeners) listener(info);
    this.bufferSink?.bufferUtterance(info);
  }

  private isCapturing(): boolean {
    return this.state === 'arming' || this.state === 'listening' || this.state === 'finalizing';
  }

  /** In an active utterance (anything but idle and the settled error/buffering display states). */
  private isActiveFlow(): boolean {
    return (
      this.state === 'arming' ||
      this.state === 'listening' ||
      this.state === 'finalizing' ||
      this.state === 'formatting' ||
      this.state === 'injecting'
    );
  }

  /** Unsubscribe capture listeners and drop the handle; optionally stop the device (error paths). */
  private teardownCapture(stop: boolean): void {
    for (const unsub of this.captureUnsubs) unsub();
    this.captureUnsubs = [];
    const capture = this.capture;
    const wasStarted = this.captureStarted;
    this.capture = undefined;
    this.captureStarted = false;
    if (stop && capture && wasStarted) {
      void capture.stop().catch(() => undefined); // best-effort; frames stay guarded by state
    }
  }

  /** End the current utterance: tear down capture (optionally stopping it) and reset all data. */
  private endUtterance(stop: boolean): void {
    this.teardownCapture(stop);
    this.resetUtterance();
  }

  private resetUtterance(): void {
    this.activeUtteranceId = undefined;
    this.currentAppContext = undefined;
    this.releaseRequested = false;
    this.framesSent = 0;
    this.audioEndSent = false;
    this.accumulated = '';
    this.injectedChars = 0;
    this.streaming = false;
    this.formatDoneReceived = false;
    this.pendingFallbackCode = undefined;
    this.injectQueue.length = 0;
    // `draining` is owned by the drain loop; a live loop will exit on the state guard.
  }
}
