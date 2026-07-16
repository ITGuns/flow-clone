// DeepgramASRProvider — CONTRACTS.md §2.1. The Deepgram streaming WebSocket vendor code lives
// ENTIRELY behind the shared ASRProvider/ASRStream surface: nothing Deepgram-shaped leaks past
// this file. It is a pure adapter — connection setup, wire framing, and error mapping, with no
// business logic beyond translating Deepgram's protocol into the contract.
//
// Wire choice: a raw `ws` client rather than the Deepgram SDK. The SDK wraps the socket in its
// own event/lifecycle model that fights the small, synchronous ASRStream surface (finalize()
// as a single awaited flush, idempotent close, cumulative-partial accumulation). The raw socket
// maps one-to-one onto the interface with far less impedance. Dep added: `ws` (+ `@types/ws`).
import { WebSocket, type RawData } from 'ws';
import type { ASRProvider, ASRStream, ASRStreamOptions } from '@undertone/shared';
import { AsrError, AsrStreamClosedError, AsrTimeoutError } from '@undertone/shared';

export interface DeepgramConfig {
  /** Deepgram API key. Sent as `Authorization: Token <key>`. */
  apiKey: string;
  /** Base WS origin. Default `wss://api.deepgram.com`. Tests point this at a local fake. */
  baseUrl?: string;
  /** Deepgram model. Default `nova-2`. */
  model?: string;
  /** Endpointing silence (ms) before Deepgram finalizes a segment. Default 300 (hop-3 budget). */
  endpointingMs?: number;
  /** finalize() deadline (ms). Default 2000 per CONTRACTS §2.1; overridable to keep tests fast. */
  finalizeTimeoutMs?: number;
  /** Connect deadline (ms) before startStream rejects with AsrError. Default 5000. */
  connectTimeoutMs?: number;
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  endpointingMs: number;
  finalizeTimeoutMs: number;
  connectTimeoutMs: number;
}

const DEFAULTS = {
  baseUrl: 'wss://api.deepgram.com',
  model: 'nova-2',
  endpointingMs: 300,
  finalizeTimeoutMs: 2000,
  connectTimeoutMs: 5000,
} as const;

function resolveConfig(config: DeepgramConfig): ResolvedConfig {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
    model: config.model ?? DEFAULTS.model,
    endpointingMs: config.endpointingMs ?? DEFAULTS.endpointingMs,
    finalizeTimeoutMs: config.finalizeTimeoutMs ?? DEFAULTS.finalizeTimeoutMs,
    connectTimeoutMs: config.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
  };
}

/** Assemble the `/v1/listen` URL. linear16/16000/mono + interim + endpointing + keywords (§2.1). */
function buildListenUrl(config: ResolvedConfig, opts: ASRStreamOptions): string {
  const url = new URL(`${config.baseUrl.replace(/\/+$/, '')}/v1/listen`);
  const p = url.searchParams;
  p.set('encoding', opts.encoding);
  p.set('sample_rate', String(opts.sampleRate));
  p.set('channels', String(opts.channels));
  p.set('interim_results', 'true');
  p.set('endpointing', String(config.endpointingMs));
  p.set('model', config.model);
  p.set('language', opts.locale);
  for (const keyword of opts.keywords ?? []) {
    p.append('keywords', keyword);
  }
  return url.toString();
}

export class DeepgramASRProvider implements ASRProvider {
  readonly #config: ResolvedConfig;

  constructor(config: DeepgramConfig) {
    this.#config = resolveConfig(config);
  }

  startStream(opts: ASRStreamOptions): Promise<ASRStream> {
    const config = this.#config;
    const url = buildListenUrl(config, opts);
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${config.apiKey}` },
    });

    return new Promise<ASRStream>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        ws.terminate();
        reject(new AsrError('deepgram connect timed out'));
      }, config.connectTimeoutMs);

      const onOpen = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(new DeepgramASRStream(ws, config));
      };
      const onUnexpected = (_req: unknown, res: { statusCode?: number }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        ws.terminate();
        reject(new AsrError(`deepgram connect failed: HTTP ${res.statusCode ?? 'unknown'}`));
      };
      const onError = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(new AsrError(`deepgram connect error: ${err.message}`));
      };
      function cleanup(): void {
        ws.off('open', onOpen);
        ws.off('unexpected-response', onUnexpected);
        ws.off('error', onError);
      }

      ws.on('open', onOpen);
      ws.on('unexpected-response', onUnexpected);
      ws.on('error', onError);
    });
  }
}

// ── Deepgram wire shapes (narrowed from JSON; never exported past this file) ─────────────────
interface DeepgramResults {
  type: 'Results';
  transcript: string;
  isFinal: boolean;
}
interface DeepgramMetadata {
  type: 'Metadata';
}
interface DeepgramError {
  type: 'Error';
  description: string;
}
type DeepgramMessage = DeepgramResults | DeepgramMetadata | DeepgramError | { type: 'Other' };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Parse a Deepgram text frame into a narrowed message. Unknown shapes collapse to `Other`. */
function parseDeepgramMessage(raw: string): DeepgramMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: 'Other' };
  }
  const obj = asRecord(parsed);
  if (obj === undefined) return { type: 'Other' };

  if (obj.type === 'Results') {
    const channel = asRecord(obj.channel);
    const alternatives = channel?.alternatives;
    const first = Array.isArray(alternatives) ? asRecord(alternatives[0]) : undefined;
    const transcript = typeof first?.transcript === 'string' ? first.transcript : '';
    return { type: 'Results', transcript, isFinal: obj.is_final === true };
  }
  if (obj.type === 'Metadata') return { type: 'Metadata' };
  if (obj.type === 'Error') {
    const description =
      typeof obj.description === 'string'
        ? obj.description
        : typeof obj.message === 'string'
          ? obj.message
          : 'deepgram error';
    return { type: 'Error', description };
  }
  return { type: 'Other' };
}

function decodeFrame(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

interface FinalizeState {
  resolve: (transcript: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

class DeepgramASRStream implements ASRStream {
  readonly #ws: WebSocket;
  readonly #config: ResolvedConfig;
  #partialCb: ((text: string) => void) | undefined;
  #errorCb: ((err: AsrError) => void) | undefined;
  #finalizedSegments: string[] = [];
  #interim = '';
  #closed = false;
  #finalizeState: FinalizeState | undefined;
  #finalizePromise: Promise<string> | undefined;

  constructor(ws: WebSocket, config: ResolvedConfig) {
    this.#ws = ws;
    this.#config = config;
    ws.on('message', (data: RawData) => {
      this.#onMessage(decodeFrame(data));
    });
    ws.on('error', (err: Error) => {
      this.#onSocketError(new AsrError(`deepgram stream error: ${err.message}`));
    });
    ws.on('close', () => {
      this.#onClose();
    });
  }

  #finalTranscript(): string {
    return this.#finalizedSegments.join(' ');
  }

  #onMessage(raw: string): void {
    const msg = parseDeepgramMessage(raw);
    switch (msg.type) {
      case 'Results': {
        // Accumulate finalized segments even after finalize() so the final transcript is whole;
        // only the live partial stream stops once finalize() has been requested.
        if (msg.isFinal) {
          if (msg.transcript.length > 0) this.#finalizedSegments.push(msg.transcript);
          this.#interim = '';
        } else {
          this.#interim = msg.transcript;
        }
        if (this.#finalizeState === undefined && this.#partialCb !== undefined) {
          const cumulative = [...this.#finalizedSegments, this.#interim]
            .filter((s) => s.length > 0)
            .join(' ');
          this.#partialCb(cumulative);
        }
        return;
      }
      case 'Metadata': {
        // Deepgram's end-of-stream marker after a flush: settle finalize() with the transcript.
        this.#settleFinalize(this.#finalTranscript());
        return;
      }
      case 'Error': {
        this.#onSocketError(new AsrError(`deepgram: ${msg.description}`));
        return;
      }
      default:
        return;
    }
  }

  #onSocketError(err: AsrError): void {
    // A mid-flight error fails any pending finalize and is surfaced to the registered handler.
    this.#rejectFinalize(err);
    this.#errorCb?.(err);
  }

  #onClose(): void {
    if (this.#finalizeState !== undefined && !this.#finalizeState.settled) {
      // Server closed after our CloseStream flush → resolve with what we accumulated.
      this.#settleFinalize(this.#finalTranscript());
      return;
    }
    if (!this.#closed) {
      // Unexpected drop with no finalize in flight → surface as a provider error.
      this.#errorCb?.(new AsrError('deepgram stream closed unexpectedly'));
    }
  }

  #settleFinalize(transcript: string): void {
    const state = this.#finalizeState;
    if (state === undefined || state.settled) return;
    state.settled = true;
    clearTimeout(state.timer);
    state.resolve(transcript);
  }

  #rejectFinalize(err: Error): void {
    const state = this.#finalizeState;
    if (state === undefined || state.settled) return;
    state.settled = true;
    clearTimeout(state.timer);
    state.reject(err);
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.#closed) throw new AsrStreamClosedError();
    this.#ws.send(chunk);
  }

  finalize(): Promise<string> {
    // Memoized: re-entrant finalize returns the same in-flight settlement.
    if (this.#finalizePromise !== undefined) return this.#finalizePromise;

    this.#finalizePromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#rejectFinalize(new AsrTimeoutError());
        this.#ws.terminate();
      }, this.#config.finalizeTimeoutMs);
      this.#finalizeState = { resolve, reject, timer, settled: false };

      if (this.#closed || this.#ws.readyState !== WebSocket.OPEN) {
        // Nothing left to flush; settle with whatever we have.
        this.#settleFinalize(this.#finalTranscript());
        return;
      }
      // Flush: ask Deepgram to finalize buffered audio and close the stream.
      this.#ws.send(JSON.stringify({ type: 'CloseStream' }));
    });
    return this.#finalizePromise;
  }

  onPartial(cb: (text: string) => void): void {
    this.#partialCb = cb;
  }

  onError(cb: (err: AsrError) => void): void {
    this.#errorCb = cb;
  }

  close(): void {
    if (this.#closed) return; // idempotent
    this.#closed = true;
    if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) {
      this.#ws.close();
    }
  }
}
