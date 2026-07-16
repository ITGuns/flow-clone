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
import type { BrowserDictationDeps } from '../dictation/useBrowserDictation';
import type { Recognizer, RecognizerEvents } from '../speech/browser-recognizer';
import type {
  FormatTranscriptResult,
  HistoryListParams,
  HistoryListResult,
  MeResponse,
  WebApi,
} from '../api/client';

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

/** A scripted fake of the browser-speech {@link Recognizer} — drive it with the emit/resolve helpers. */
export class FakeRecognizer implements Recognizer {
  private events: RecognizerEvents = {};
  started = 0;
  aborted = 0;
  private running = false;
  private readonly stopResolvers: ((transcript: string) => void)[] = [];

  get active(): boolean {
    return this.running;
  }

  start(events: RecognizerEvents): void {
    this.events = events;
    this.started += 1;
    this.running = true;
  }
  stop(): Promise<string> {
    this.running = false;
    return new Promise<string>((resolve) => this.stopResolvers.push(resolve));
  }
  abort(): void {
    this.aborted += 1;
    this.running = false;
  }

  // ── drivers ──────────────────────────────────────────────────────────────────────────────
  emitInterim(text: string): void {
    this.events.onInterim?.(text);
  }
  emitError(error: string, message = ''): void {
    this.events.onError?.({ error, message });
  }
  /** Resolve the pending stop() with the finalized transcript. */
  resolveStop(transcript: string): void {
    const resolve = this.stopResolvers.shift();
    if (resolve) resolve(transcript);
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

export interface FakeBrowserHandle {
  browser: BrowserDictationDeps;
  recognizer: FakeRecognizer;
  formatCalls: { transcript: string; appContext: AppContext }[];
}

/** Build browser-speech deps backed by a single {@link FakeRecognizer} + a scripted format result. */
export function makeFakeBrowserDeps(result?: Partial<FormatTranscriptResult>): FakeBrowserHandle {
  const recognizer = new FakeRecognizer();
  const formatCalls: { transcript: string; appContext: AppContext }[] = [];
  const merged: FormatTranscriptResult = {
    text: 'Hello world.',
    wordCount: 2,
    commandsApplied: [],
    usage: { wordsThisWeek: 42, limit: 50000 },
    exceeded: false,
    ...result,
  };
  const browser: BrowserDictationDeps = {
    createRecognizer: () => recognizer,
    formatTranscript: (transcript, appContext) => {
      formatCalls.push({ transcript, appContext });
      return Promise.resolve(merged);
    },
  };
  return { browser, recognizer, formatCalls };
}

const DEFAULT_ME: MeResponse = {
  userId: 'user_mock',
  email: 'mock@undertone.dev',
  plan: 'pro',
  trialEndsAt: null,
  usage: { wordsThisWeek: 120, limit: 50000 },
};

const DEFAULT_FORMAT: FormatTranscriptResult = {
  text: 'Hello world.',
  wordCount: 2,
  commandsApplied: [],
  usage: { wordsThisWeek: 42, limit: 50000 },
  exceeded: false,
};

export interface FakeApiOptions {
  me?: MeResponse;
  history?: (params: HistoryListParams) => HistoryListResult;
  format?: FormatTranscriptResult;
}

export class FakeApi implements WebApi {
  readonly listCalls: HistoryListParams[] = [];
  readonly deleted: string[] = [];
  readonly formatCalls: { transcript: string; appContext: AppContext }[] = [];
  private readonly meValue: MeResponse;
  private readonly historyHandler: (params: HistoryListParams) => HistoryListResult;
  private readonly formatValue: FormatTranscriptResult;

  constructor(options: FakeApiOptions = {}) {
    this.meValue = options.me ?? DEFAULT_ME;
    this.historyHandler = options.history ?? (() => ({ items: [] }));
    this.formatValue = options.format ?? DEFAULT_FORMAT;
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
  formatTranscript(transcript: string, appContext: AppContext): Promise<FormatTranscriptResult> {
    this.formatCalls.push({ transcript, appContext });
    return Promise.resolve(this.formatValue);
  }
}
