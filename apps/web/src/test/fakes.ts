// Test doubles for the injected collaborators. All type-only imports of the shared/client modules,
// so importing this file into a jsdom `.test.tsx` never pulls the shared golden-fixture side-effect.
import type { AppContext } from '@undertone/shared';
import type { AudioCaptureLike } from '../audio/audio-capture';
import type { VadResult } from '../audio/vad';
import type {
  ConnectionStatus,
  DictationClientLike,
  DictationEvents,
} from '../ws/dictation-client';
import type { DictationDeps } from '../dictation/useDictation';
import type { HistoryListParams, HistoryListResult, MeResponse, WebApi } from '../api/client';

export class FakeDictationClient implements DictationClientLike {
  readonly events: DictationEvents;
  status: ConnectionStatus = 'idle';
  readonly beginCalls: AppContext[] = [];
  readonly frames: Uint8Array[] = [];
  ended = 0;
  closed = 0;
  private counter = 0;

  constructor(events: DictationEvents) {
    this.events = events;
  }

  connect(_appContext: AppContext): Promise<void> {
    this.status = 'connecting';
    this.events.onStatus?.('connecting');
    this.status = 'ready';
    this.events.onStatus?.('ready');
    return Promise.resolve();
  }

  beginUtterance(appContext: AppContext): number {
    this.beginCalls.push(appContext);
    this.counter += 1;
    return this.counter;
  }

  sendAudioFrame(payload: Uint8Array): void {
    this.frames.push(payload);
  }

  endUtterance(): void {
    this.ended += 1;
  }

  close(): void {
    this.closed += 1;
    this.status = 'closed';
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ── server-event drivers ─────────────────────────────────────────────────────────────────
  emitPartial(id: number, text: string): void {
    this.events.onPartial?.(id, text);
  }
  emitFinal(id: number, text: string, asrMs = 100): void {
    this.events.onFinal?.(id, text, asrMs);
  }
  emitDelta(id: number, text: string): void {
    this.events.onFormatDelta?.(id, text);
  }
  emitDone(id: number, text: string, wordCount: number, unformatted = false): void {
    this.events.onFormatDone?.({ utteranceId: id, text, wordCount, unformatted });
  }
  emitUsage(wordsThisWeek: number, limit: number): void {
    this.events.onUsage?.(wordsThisWeek, limit);
  }
  emitQuota(id: number): void {
    this.events.onQuotaExceeded?.(id);
  }
  emitError(code: string, message: string): void {
    this.events.onError?.({ code: code as never, message, retryable: false });
  }
}

export class FakeCapture implements AudioCaptureLike {
  private readonly frameListeners: ((frame: Uint8Array, seq: number) => void)[] = [];
  private readonly vadListeners: ((r: VadResult) => void)[] = [];
  private readonly endListeners: (() => void)[] = [];
  private readonly errorListeners: ((e: Error) => void)[] = [];
  started = 0;
  stopped = 0;

  onFrame(l: (frame: Uint8Array, seq: number) => void): () => void {
    this.frameListeners.push(l);
    return () => undefined;
  }
  onVad(l: (r: VadResult) => void): () => void {
    this.vadListeners.push(l);
    return () => undefined;
  }
  onEnd(l: () => void): () => void {
    this.endListeners.push(l);
    return () => undefined;
  }
  onError(l: (e: Error) => void): () => void {
    this.errorListeners.push(l);
    return () => undefined;
  }
  start(): Promise<void> {
    this.started += 1;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.stopped += 1;
    for (const l of this.endListeners) l();
    return Promise.resolve();
  }

  emitFrame(frame: Uint8Array): void {
    for (const l of this.frameListeners) l(frame, 0);
  }
  emitVad(level: number, speaking = true): void {
    for (const l of this.vadListeners) l({ level, speaking });
  }
}

export interface FakeDepsHandle {
  deps: DictationDeps;
  client(): FakeDictationClient;
  captures: FakeCapture[];
}

export function makeFakeDeps(): FakeDepsHandle {
  let created: FakeDictationClient | null = null;
  const captures: FakeCapture[] = [];
  const deps: DictationDeps = {
    createClient: (events) => {
      created = new FakeDictationClient(events);
      return created;
    },
    createCapture: () => {
      const capture = new FakeCapture();
      captures.push(capture);
      return capture;
    },
  };
  return {
    deps,
    client: () => {
      if (!created) throw new Error('client not created yet');
      return created;
    },
    captures,
  };
}

const DEFAULT_ME: MeResponse = {
  userId: 'user_mock',
  email: 'mock@undertone.dev',
  plan: 'pro',
  trialEndsAt: null,
  usage: { wordsThisWeek: 120, limit: 50000 },
};

export interface FakeApiOptions {
  me?: MeResponse;
  history?: (params: HistoryListParams) => HistoryListResult;
}

export class FakeApi implements WebApi {
  readonly listCalls: HistoryListParams[] = [];
  readonly deleted: string[] = [];
  private readonly meValue: MeResponse;
  private readonly historyHandler: (params: HistoryListParams) => HistoryListResult;

  constructor(options: FakeApiOptions = {}) {
    this.meValue = options.me ?? DEFAULT_ME;
    this.historyHandler = options.history ?? (() => ({ items: [] }));
  }

  getSessionToken(): Promise<string> {
    return Promise.resolve('fake-token');
  }
  getMe(): Promise<MeResponse> {
    return Promise.resolve(this.meValue);
  }
  listHistory(params: HistoryListParams = {}): Promise<HistoryListResult> {
    this.listCalls.push(params);
    return Promise.resolve(this.historyHandler(params));
  }
  deleteHistory(id: string): Promise<void> {
    this.deleted.push(id);
    return Promise.resolve();
  }
}
