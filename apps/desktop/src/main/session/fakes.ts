// Scripted fakes for the session orchestrator tests. Not a test file (no `.test`), so it is
// compiled/linted with the sources but never run as a suite. Each fake is the minimal structural
// implementation of a port from ports.ts, plus test controls to drive it and inspect what the
// orchestrator did.
import {
  UndertoneError,
  toErrorMessage,
  type ClientMessage,
  type ErrorCode,
  type UtteranceId,
} from '@undertone/shared';
import { TypedEmitter, type ConnectionState, type WsClientEventMap } from '../../ws';
import type { InjectResult } from '../../native';
import type { HudState } from '../../ipc-contract';
import type {
  AppDetectPort,
  CapturePort,
  CaptureVad,
  Clock,
  HotkeyPort,
  InjectPort,
  WsPort,
} from './ports';

// ── Hotkey ─────────────────────────────────────────────────────────────────────────────────
export class FakeHotkey implements HotkeyPort {
  private cb: ((phase: 'down' | 'up') => void) | undefined;
  registrations = 0;
  unregistered = 0;

  register(_accelerator: string, cb: (phase: 'down' | 'up') => void): () => void {
    this.cb = cb;
    this.registrations += 1;
    return () => {
      this.unregistered += 1;
      this.cb = undefined;
    };
  }

  down(): void {
    this.cb?.('down');
  }
  up(): void {
    this.cb?.('up');
  }
}

// ── Capture ────────────────────────────────────────────────────────────────────────────────
export class FakeCapture implements CapturePort {
  private frameListeners = new Set<(frame: Uint8Array, frameSeq: number) => void>();
  private vadListeners = new Set<(result: CaptureVad) => void>();
  private errorListeners = new Set<(err: Error) => void>();
  private seq = 0;
  started = false;
  stopped = false;
  /** When set, the trailing partial frame flushed on stop(). Mirrors AudioCapture's tail flush. */
  tailFrame: Uint8Array | undefined;

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    if (this.tailFrame) {
      this.emitFrame(this.tailFrame); // flush the tail before end, like AudioCapture.stop()
      this.tailFrame = undefined;
    }
    this.stopped = true;
    return Promise.resolve();
  }

  onFrame(listener: (frame: Uint8Array, frameSeq: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }
  onVad(listener: (result: CaptureVad) => void): () => void {
    this.vadListeners.add(listener);
    return () => this.vadListeners.delete(listener);
  }
  onError(listener: (err: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // ── Test controls ──
  emitFrame(frame: Uint8Array = new Uint8Array(640)): void {
    const s = this.seq;
    this.seq += 1;
    for (const l of this.frameListeners) l(frame, s);
  }
  emitVad(level: number, speaking = true): void {
    for (const l of this.vadListeners) l({ level, speaking });
  }
  emitError(err: Error = new Error('capture failed')): void {
    for (const l of this.errorListeners) l(err);
  }
}

/** Hands out a fresh {@link FakeCapture} per call and remembers them all. */
export class FakeCaptureFactory {
  readonly created: FakeCapture[] = [];
  create = (): CapturePort => {
    const c = new FakeCapture();
    this.created.push(c);
    return c;
  };
  get last(): FakeCapture {
    const c = this.created[this.created.length - 1];
    if (!c) throw new Error('no capture created yet');
    return c;
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────────────────────────
export class FakeWs implements WsPort {
  private readonly emitter = new TypedEmitter<WsClientEventMap>();
  readonly controls: ClientMessage[] = [];
  readonly frames: Array<{ utteranceId: UtteranceId; payload: Uint8Array }> = [];
  connects = 0;
  closed = false;
  private state: ConnectionState = 'closed';
  /** When true, sendFrame rejects (ring full) and emits OFFLINE_BUFFERED, like the real client. */
  rejectFrames = false;

  connect(): Promise<void> {
    this.connects += 1;
    this.setState('ready');
    return Promise.resolve();
  }

  sendControl(msg: ClientMessage): void {
    this.controls.push(msg);
  }

  sendFrame(utteranceId: UtteranceId, payload: Uint8Array): boolean {
    if (this.rejectFrames) {
      this.emitter.emit(
        'error',
        toErrorMessage(
          new UndertoneError('OFFLINE_BUFFERED', 'replay buffer full', {
            retryable: true,
            utteranceId,
          }),
        ),
      );
      return false;
    }
    this.frames.push({ utteranceId, payload });
    return true;
  }

  getState(): ConnectionState {
    return this.state;
  }

  on<K extends keyof WsClientEventMap>(
    key: K,
    cb: (payload: WsClientEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(key, cb);
  }

  close(): void {
    this.closed = true;
    this.setState('closed');
  }

  // ── Test controls: drive server → client ──
  server<K extends keyof WsClientEventMap>(key: K, payload: WsClientEventMap[K]): void {
    this.emitter.emit(key, payload);
  }
  setState(next: ConnectionState): void {
    this.state = next;
    this.emitter.emit('state', next);
  }
  errorCode(code: ErrorCode, utteranceId?: UtteranceId, retryable = false): void {
    this.emitter.emit('error', {
      t: 'error',
      code,
      message: code,
      retryable,
      ...(utteranceId !== undefined ? { utteranceId } : {}),
    });
  }
  /** Control messages of a given type the orchestrator sent. */
  controlsOfType<T extends ClientMessage['t']>(t: T): Array<Extract<ClientMessage, { t: T }>> {
    return this.controls.filter((m): m is Extract<ClientMessage, { t: T }> => m.t === t);
  }
}

// ── Injection ──────────────────────────────────────────────────────────────────────────────
export class FakeInject implements InjectPort {
  readonly calls: string[] = [];
  /** Result returned for each call; a single value applies to every call. */
  private result: InjectResult = { ok: true, method: 'sendinput' };
  private failNext = false;

  inject(text: string): Promise<InjectResult> {
    this.calls.push(text);
    if (this.failNext) {
      this.failNext = false;
      return Promise.resolve({ ok: false, code: 'INJECT_FAILED', message: 'boom' });
    }
    return Promise.resolve(this.result);
  }

  /** All injected chunks concatenated — the text that reached the cursor, in order. */
  get injected(): string {
    return this.calls.join('');
  }
  failOnce(): void {
    this.failNext = true;
  }
  alwaysFail(code: 'NO_PERMISSION' | 'NO_TARGET' | 'INJECT_FAILED' = 'INJECT_FAILED'): void {
    this.result = { ok: false, code, message: code };
  }
}

// ── Active-app detection ───────────────────────────────────────────────────────────────────
export class FakeAppDetect implements AppDetectPort {
  raw: { bundleId: string; appName: string; windowTitle: string } = {
    bundleId: 'slack.exe',
    appName: 'Slack',
    windowTitle: '',
  };
  private reject = false;

  getActiveApp(): Promise<{ bundleId: string; appName: string; windowTitle: string }> {
    if (this.reject) return Promise.reject(new Error('detector failed'));
    return Promise.resolve(this.raw);
  }
  failNext(): void {
    this.reject = true;
  }
}

// ── Clock ──────────────────────────────────────────────────────────────────────────────────
interface FakeTask {
  due: number;
  fn: () => void;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  private t = 0;
  private tasks: FakeTask[] = [];

  now(): number {
    return this.t;
  }

  schedule(handler: () => void, delayMs: number): () => void {
    const task: FakeTask = { due: this.t + delayMs, fn: handler, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  /** Advance time by `ms`, firing every due (uncancelled) timer in order. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let next: FakeTask | undefined;
      for (const task of this.tasks) {
        if (task.cancelled || task.due > target) continue;
        if (!next || task.due < next.due) next = task;
      }
      if (!next) break;
      this.t = next.due;
      next.cancelled = true;
      next.fn();
    }
    this.t = target;
  }
}

// ── HUD sink recorder ──────────────────────────────────────────────────────────────────────
export class HudRecorder {
  readonly states: HudState[] = [];
  sink = (state: HudState): void => {
    this.states.push(state);
  };
  get phases(): HudState['phase'][] {
    return this.states.map((s) => s.phase);
  }
  /** Phases with consecutive duplicates collapsed — the visible transition sequence. */
  get phaseSequence(): HudState['phase'][] {
    const out: HudState['phase'][] = [];
    for (const s of this.states) {
      if (out[out.length - 1] !== s.phase) out.push(s.phase);
    }
    return out;
  }
  get last(): HudState {
    const s = this.states[this.states.length - 1];
    if (!s) throw new Error('no HUD state emitted yet');
    return s;
  }
}

/** Flush pending microtasks so the orchestrator's awaited async steps settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}
