// Session orchestrator ports — the narrow, constructor-injected boundaries the orchestrator
// (orchestrator.ts) drives. Each port is a *structural* subset of a real class that already
// exists in the repo, so the production implementation satisfies it without any adapter and the
// unit tests satisfy it with fakes (fakes.ts). Nothing here redeclares a protocol type — the
// wire/domain shapes come from @undertone/shared; the desktop-internal HUD shape comes from the
// frozen ipc-contract.ts.
//
//   HotkeyPort     ⇐ native HotkeyManager        (CONTRACTS §2.3)
//   CapturePort    ⇐ audio AudioCapture          (per-utterance; see CaptureFactory)
//   WsPort         ⇐ ws WsClient                 (CONTRACTS §4)
//   InjectPort     ⇐ native TextInjector         (CONTRACTS §2.3)
//   AppDetectPort  ⇐ native ActiveAppDetector    (CONTRACTS §2.3 + shared buildAppContext)
//   HudSink        ⇒ main→HUD state push          (ipc-contract.ts)
//   BufferSink     ⇒ offline-buffer seam (task 5a owns retry)
//   Clock          ⇐ injectable timers            (deterministic under test)

import type { AppContext, ClientMessage, ErrorCode, UtteranceId } from '@undertone/shared';
import type { ConnectionState, Listener, WsClientEventMap } from '../../ws';
import type { InjectResult } from '../../native';
import type { HudState } from '../../ipc-contract';

/**
 * Global push-to-talk key. `cb` fires on transitions only (`down`/`up`). Structural subset of the
 * native `HotkeyManager` (which also carries `isSupported`, unused here).
 */
export interface HotkeyPort {
  register(accelerator: string, cb: (phase: 'down' | 'up') => void): () => void;
}

/** Per-frame VAD result the HUD level display reads. Structurally matches audio `VadResult`. */
export interface CaptureVad {
  level: number;
  speaking: boolean;
}

/**
 * One utterance's worth of capture. Single-use, exactly like the audio `AudioCapture` it mirrors
 * (`start` once, `stop` once), which is why the orchestrator takes a {@link CaptureFactory} rather
 * than a single instance — a fresh capture is created per key-down.
 */
export interface CapturePort {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(listener: (frame: Uint8Array, frameSeq: number) => void): () => void;
  onVad(listener: (result: CaptureVad) => void): () => void;
  onError(listener: (err: Error) => void): () => void;
}

/** Produces a fresh {@link CapturePort} per utterance. Prod: `() => new AudioCapture({ source })`. */
export type CaptureFactory = () => CapturePort;

/**
 * The WebSocket client surface the orchestrator uses. Structural subset of `WsClient`: the client
 * owns frameSeq + the replay ring (so `sendFrame` takes only the payload) and sniffs the control
 * messages the orchestrator sends to drive resume/replay.
 */
export interface WsPort {
  connect(): Promise<void>;
  sendControl(msg: ClientMessage): void;
  /** Returns false when the replay ring is full (→ an `OFFLINE_BUFFERED` `error` event fires too). */
  sendFrame(utteranceId: UtteranceId, payload: Uint8Array): boolean;
  getState(): ConnectionState;
  on<K extends keyof WsClientEventMap>(key: K, cb: Listener<WsClientEventMap[K]>): () => void;
  close(): void;
}

/** Native text injection at the cursor. Structurally the native `TextInjector`. */
export interface InjectPort {
  inject(text: string): Promise<InjectResult>;
}

/** Frontmost-app detection. Structurally the native `ActiveAppDetector`. */
export interface AppDetectPort {
  getActiveApp(): Promise<Omit<AppContext, 'register'>>;
}

/** main → HUD renderer: full-state push on every change (ipc-contract.ts). */
export type HudSink = (state: HudState) => void;

/**
 * A captured utterance handed off to the offline buffer when the transport is lost during capture
 * (CONTRACTS §3 `buffering`). Task 5a owns the actual persistence + retry; the orchestrator only
 * signals. It does NOT carry audio — the WsClient owns the replay ring (this client never persists
 * audio, per ws/types.ts).
 */
export interface BufferedUtterance {
  utteranceId: UtteranceId;
  appContext: AppContext;
  /** Which §8 code drove the hand-off (OFFLINE_BUFFERED / ASR_* / SESSION_INVALID). */
  reason: ErrorCode;
}

/** Offline-buffer seam (task 5a). Optional; the orchestrator also exposes `onBuffered`. */
export interface BufferSink {
  bufferUtterance(info: BufferedUtterance): void;
}

/**
 * Injectable time source. `schedule` returns a cancel fn (no opaque handle types to thread through
 * tests). Default is {@link systemClock}; tests pass a deterministic fake.
 */
export interface Clock {
  now(): number;
  schedule(handler: () => void, delayMs: number): () => void;
}

/** Real timers + wall clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (handler, delayMs) => {
    const timer = setTimeout(handler, delayMs);
    return () => clearTimeout(timer);
  },
};

/** The ports the orchestrator is constructed with. */
export interface SessionOrchestratorPorts {
  hotkey: HotkeyPort;
  createCapture: CaptureFactory;
  ws: WsPort;
  inject: InjectPort;
  appDetect: AppDetectPort;
  hud: HudSink;
}
