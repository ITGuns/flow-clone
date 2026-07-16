// Browser WS client — CONTRACTS §4. A lean counterpart to the desktop main-process client: it does
// NOT implement the full replay ring (web v1 accepts losing a mid-utterance's audio on transport
// loss — documented in DECISIONS D-023). It authenticates with a fresh §5 session token, runs the
// §4.3 handshake (session.start → session.ready), streams one utterance at a time (utterance.start
// → binary frames → audio.end), and maps §8 server errors to honest UI callbacks.
//
// Reconnect policy (web v1): on an unexpected socket close it fetches a FRESH token and re-opens a
// new session once. An in-flight utterance is dropped (no replay); the UI resets its recording.
import {
  encodeAudioFrame,
  type AppContext,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@undertone/shared';

/** The subset of the browser `WebSocket` the client needs; lets tests inject a scripted fake. */
export interface DictationSocket {
  send(data: string | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type SocketFactory = (url: string) => DictationSocket;

/** `WebSocket.OPEN`. */
export const SOCKET_OPEN = 1;

/** Default factory over the real browser WebSocket, configured for binary (arraybuffer) frames. */
export const browserSocketFactory: SocketFactory = (url) => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  return ws as unknown as DictationSocket;
};

export type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed';

/** A §8 error surfaced to the UI as a blocking/informative state (FORMAT_ and QUOTA handled apart). */
export interface DictationError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  utteranceId?: number;
}

/** The finalized, formatted (or raw-fallback) result of one utterance. */
export interface FormattedResult {
  utteranceId: number;
  text: string;
  wordCount: number;
  /** True when a §8 FORMAT_* fired and the server delivered the RAW transcript instead. */
  unformatted: boolean;
}

export interface DictationEvents {
  onStatus?: (status: ConnectionStatus) => void;
  onPartial?: (utteranceId: number, text: string) => void;
  onFinal?: (utteranceId: number, text: string, asrMs: number) => void;
  onFormatDelta?: (utteranceId: number, text: string) => void;
  onFormatDone?: (result: FormattedResult) => void;
  onUsage?: (wordsThisWeek: number, limit: number) => void;
  /** §8 QUOTA_EXCEEDED — the result was already delivered; show an upgrade hint, do not block. */
  onQuotaExceeded?: (utteranceId: number) => void;
  onError?: (error: DictationError) => void;
}

/** The client surface the dictation hook depends on — lets `.tsx` tests inject a fake (which keeps
 *  the shared golden-fixture side-effect out of the jsdom Vite transform). */
export interface DictationClientLike {
  connect(appContext: AppContext): Promise<void>;
  beginUtterance(appContext: AppContext): number;
  sendAudioFrame(payload: Uint8Array): void;
  endUtterance(): void;
  close(): void;
  getStatus(): ConnectionStatus;
}

export interface DictationClientOptions {
  /** Full WS URL without the token query, e.g. `ws://localhost:8080/v1/stream`. */
  wsUrl: string;
  /** Fetch a fresh §5 session token (mock mode authenticates automatically). */
  tokenProvider: () => Promise<string>;
  events?: DictationEvents;
  /** Injected in tests. Defaults to the real browser WebSocket. */
  socketFactory?: SocketFactory;
  /** Injected in tests. Defaults to `crypto.randomUUID`. */
  sessionIdFactory?: () => string;
  locale?: string;
}

function defaultSessionId(): string {
  return globalThis.crypto.randomUUID();
}

/** A §4.3 error frame the server may send; narrowed from ServerMessage for the mapping switch. */
type ErrorFrame = Extract<ServerMessage, { t: 'error' }>;

export class DictationClient implements DictationClientLike {
  private readonly wsUrl: string;
  private readonly tokenProvider: () => Promise<string>;
  private readonly events: DictationEvents;
  private readonly socketFactory: SocketFactory;
  private readonly sessionIdFactory: () => string;
  private readonly locale: string;

  private socket: DictationSocket | null = null;
  private status: ConnectionStatus = 'idle';
  private sessionId: string | null = null;
  private appContext: AppContext | null = null;

  private utteranceCounter = 0;
  private activeUtteranceId: number | null = null;
  private frameSeq = 0;
  /** Utterances that received a §8 FORMAT_* error → their following format.done is "unformatted". */
  private readonly formatFallback = new Set<number>();

  private intentionalClose = false;
  private reconnectRemaining = 1;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;

  constructor(options: DictationClientOptions) {
    this.wsUrl = options.wsUrl;
    this.tokenProvider = options.tokenProvider;
    this.events = options.events ?? {};
    this.socketFactory = options.socketFactory ?? browserSocketFactory;
    this.sessionIdFactory = options.sessionIdFactory ?? defaultSessionId;
    this.locale = options.locale ?? 'en-US';
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Open the socket, run the handshake, resolve once `session.ready` is received. */
  connect(appContext: AppContext): Promise<void> {
    this.appContext = appContext;
    this.intentionalClose = false;
    this.reconnectRemaining = 1;
    return this.open('connecting');
  }

  /** Begin one utterance: assigns the next id, resets frame seq, sends `utterance.start`. */
  beginUtterance(appContext: AppContext): number {
    this.appContext = appContext;
    this.utteranceCounter += 1;
    const utteranceId = this.utteranceCounter;
    this.activeUtteranceId = utteranceId;
    this.frameSeq = 0;
    this.sendControl({ t: 'utterance.start', utteranceId, appContext });
    return utteranceId;
  }

  /** Stream one 640-byte PCM16LE frame for the active utterance. No-op if none is active. */
  sendAudioFrame(payload: Uint8Array): void {
    const utteranceId = this.activeUtteranceId;
    if (utteranceId === null) return;
    const seq = this.frameSeq;
    this.frameSeq += 1;
    this.sendBinary(encodeAudioFrame(utteranceId, seq, payload));
  }

  /** Close out the active utterance: sends `audio.end`. `lastFrameSeq` is -1 when no frame flowed. */
  endUtterance(): void {
    const utteranceId = this.activeUtteranceId;
    if (utteranceId === null) return;
    this.sendControl({ t: 'audio.end', utteranceId, lastFrameSeq: this.frameSeq - 1 });
    this.activeUtteranceId = null;
  }

  /** Deliberate shutdown — no reconnect. */
  close(): void {
    this.intentionalClose = true;
    this.activeUtteranceId = null;
    this.setStatus('closed');
    this.teardownSocket(1000);
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────

  private open(status: ConnectionStatus): Promise<void> {
    this.setStatus(status);
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      void this.tokenProvider()
        .then((token) => {
          if (this.intentionalClose) return;
          const socket = this.socketFactory(`${this.wsUrl}?token=${encodeURIComponent(token)}`);
          this.socket = socket;
          socket.onopen = () => this.onOpen();
          socket.onmessage = (event) => this.onRawMessage(event.data);
          socket.onclose = (event) => this.onSocketClose(event.code);
          socket.onerror = () => {
            /* close follows an error; handled in onSocketClose */
          };
        })
        .catch((err: unknown) => {
          this.failReady(err instanceof Error ? err : new Error(String(err)));
          this.setStatus('closed');
        });
    });
  }

  private onOpen(): void {
    if (!this.appContext) return;
    this.sessionId = this.sessionIdFactory();
    this.utteranceCounter = 0;
    this.activeUtteranceId = null;
    this.sendControl({
      t: 'session.start',
      sessionId: this.sessionId,
      appContext: this.appContext,
      locale: this.locale,
    });
  }

  private onRawMessage(data: unknown): void {
    if (typeof data !== 'string') return; // server→client control is always JSON text
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    this.onServerMessage(msg);
  }

  private onServerMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'session.ready':
        this.setStatus('ready');
        this.resolveReady();
        return;
      case 'transcript.partial':
        this.events.onPartial?.(msg.utteranceId, msg.text);
        return;
      case 'transcript.final':
        this.events.onFinal?.(msg.utteranceId, msg.text, msg.asrMs);
        return;
      case 'format.delta':
        this.events.onFormatDelta?.(msg.utteranceId, msg.text);
        return;
      case 'format.done': {
        const unformatted = this.formatFallback.delete(msg.utteranceId);
        this.events.onFormatDone?.({
          utteranceId: msg.utteranceId,
          text: msg.text,
          wordCount: msg.wordCount,
          unformatted,
        });
        return;
      }
      case 'usage.update':
        this.events.onUsage?.(msg.wordsThisWeek, msg.limit);
        return;
      case 'error':
        this.onErrorFrame(msg);
        return;
      case 'pong':
      case 'audio.ack':
        return;
    }
  }

  private onErrorFrame(frame: ErrorFrame): void {
    switch (frame.code) {
      case 'FORMAT_UNAVAILABLE':
      case 'FORMAT_TIMEOUT':
        // A `format.done` with the RAW transcript follows (§8). Mark it so the UI notes it.
        if (frame.utteranceId !== undefined) this.formatFallback.add(frame.utteranceId);
        return;
      case 'QUOTA_EXCEEDED':
        // The result was already delivered (D-020); surface a non-blocking upgrade hint.
        this.events.onQuotaExceeded?.(frame.utteranceId ?? this.utteranceCounter);
        return;
      case 'AUTH_EXPIRED':
        // Silent refresh-and-reconnect (§8). The socket close will drive the reconnect.
        return;
      default:
        this.events.onError?.({
          code: frame.code,
          message: frame.message,
          retryable: frame.retryable,
          ...(frame.retryAfterMs !== undefined ? { retryAfterMs: frame.retryAfterMs } : {}),
          ...(frame.utteranceId !== undefined ? { utteranceId: frame.utteranceId } : {}),
        });
        return;
    }
  }

  private onSocketClose(_code: number): void {
    this.socket = null;
    if (this.intentionalClose) {
      this.setStatus('closed');
      return;
    }
    if (this.reconnectRemaining > 0) {
      this.reconnectRemaining -= 1;
      // Drop any in-flight utterance; web v1 does not replay (DECISIONS D-023).
      this.activeUtteranceId = null;
      void this.open('reconnecting').catch(() => {
        /* failReady already surfaced the error */
      });
      return;
    }
    this.failReady(new Error('connection lost'));
    this.setStatus('closed');
    this.events.onError?.({
      code: 'OFFLINE_BUFFERED',
      message: 'Lost connection to the dictation service.',
      retryable: true,
    });
  }

  private resolveReady(): void {
    this.readyResolve?.();
    this.readyResolve = null;
    this.readyReject = null;
  }

  private failReady(err: Error): void {
    this.readyReject?.(err);
    this.readyResolve = null;
    this.readyReject = null;
  }

  private sendControl(msg: ClientMessage): void {
    this.sendRaw(JSON.stringify(msg));
  }

  private sendBinary(frame: Uint8Array): void {
    this.sendRaw(frame);
  }

  private sendRaw(data: string | Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(data);
  }

  private teardownSocket(code: number): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    try {
      socket.close(code);
    } catch {
      /* already closing */
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus?.(status);
  }
}
