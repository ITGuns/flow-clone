// ASRProvider — CONTRACTS.md §2.1. Vendor SDKs (Deepgram) live only behind this interface;
// MockASRProvider (Phase 1) implements the same surface from fixture files.
import type { AsrError } from './errors';

export interface ASRProvider {
  /** Open a streaming session. MUST resolve before first sendAudio. */
  startStream(opts: ASRStreamOptions): Promise<ASRStream>;
}

export interface ASRStreamOptions {
  sampleRate: 16000;
  encoding: 'linear16';
  channels: 1;
  locale: string;
  keywords?: string[]; // dictionary phrases for ASR biasing (provider may ignore)
}

export interface ASRStream {
  sendAudio(chunk: Uint8Array): void; // PCM16LE; throws AsrStreamClosedError after close
  finalize(): Promise<string>; // flush → final transcript; rejects with AsrTimeoutError after 2000ms
  onPartial(cb: (text: string) => void): void; // cumulative-partial semantics: each call replaces the previous partial
  onError(cb: (err: AsrError) => void): void;
  close(): void; // idempotent, releases the connection
}
