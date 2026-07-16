// Public API of the audio capture pipeline (ARCHITECTURE §2 step 2). Wires a `MicSource` through
// resample → PCM16 → 20ms framing → energy VAD, and emits ordered 640-byte frames (each tagged
// with a per-capture `frameSeq` starting at 0, matching CONTRACTS §4.2) plus per-frame VAD
// results for the HUD. The WS client (task 1b) consumes `frame` events; it owns the wire header.
//
//   MicSource ──chunk(Float32 @ srcRate)──► resampleTo16k ──► floatTo16BitPCM
//        ──► FrameChunker (640B frames, carries remainder) ──► EnergyVAD ──► frame + vad events
//
// stop() releases the device, flushes the trailing partial frame zero-padded, and emits `end`.

import { floatTo16BitPCM, resampleTo16k } from './dsp';
import { FrameChunker } from './frame-chunker';
import { EnergyVAD, type EnergyVADOptions, type VadResult } from './vad';
import type { MicChunk, MicSource } from './mic-source';

export interface AudioCaptureOptions {
  /** The capture device (real `WebAudioMicSource` in-app, `FakeMicSource` in tests). */
  source: MicSource;
  /** Optional VAD tuning; defaults are fine for the HUD. */
  vad?: EnergyVADOptions;
}

type CaptureState = 'idle' | 'running' | 'stopped';

/**
 * Orchestrates the capture pipeline. One instance is single-use: `start` once, `stop` once.
 * Subscribe with the `onFrame`/`onVad`/`onEnd`/`onError` methods (each returns an unsubscribe fn).
 */
export class AudioCapture {
  private readonly source: MicSource;
  private readonly chunker = new FrameChunker();
  private readonly vad: EnergyVAD;

  private readonly frameListeners = new Set<(frame: Uint8Array, frameSeq: number) => void>();
  private readonly vadListeners = new Set<(result: VadResult) => void>();
  private readonly endListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(err: Error) => void>();

  private state: CaptureState = 'idle';
  private frameSeq = 0;

  constructor(options: AudioCaptureOptions) {
    this.source = options.source;
    this.vad = new EnergyVAD(options.vad);
  }

  /** Sequence number the next emitted frame will carry (0 before any frame). */
  get nextFrameSeq(): number {
    return this.frameSeq;
  }

  /** Subscribe to ordered 640-byte PCM16LE frames. Returns an unsubscribe fn. */
  onFrame(listener: (frame: Uint8Array, frameSeq: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Subscribe to per-frame VAD results (HUD level + speaking). Returns an unsubscribe fn. */
  onVad(listener: (result: VadResult) => void): () => void {
    this.vadListeners.add(listener);
    return () => this.vadListeners.delete(listener);
  }

  /** Fires once after the final (flushed) frame when capture stops. Returns an unsubscribe fn. */
  onEnd(listener: () => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Fires on a pipeline error (e.g. bad input rate). Returns an unsubscribe fn. */
  onError(listener: (err: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Open the device and begin emitting frames. Throws if already started or already stopped. */
  async start(): Promise<void> {
    if (this.state === 'running') {
      throw new Error('AudioCapture.start: already started');
    }
    if (this.state === 'stopped') {
      throw new Error(
        'AudioCapture.start: capture is single-use; create a new instance to restart',
      );
    }
    this.state = 'running';
    this.frameSeq = 0;
    this.chunker.reset();
    this.vad.reset();
    await this.source.start((chunk) => this.ingest(chunk));
  }

  /**
   * Stop the device, flush the trailing partial frame (zero-padded) as one last in-order frame,
   * then emit `end`. Throws if capture was never started (the stop-without-start failure path).
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      throw new Error('AudioCapture.stop: not started');
    }
    this.state = 'stopped';
    await this.source.stop();
    const tail = this.chunker.flush();
    if (tail) this.emitFrame(tail);
    this.emitEnd();
  }

  private ingest(chunk: MicChunk): void {
    if (this.state !== 'running') return; // ignore late chunks that race a stop()
    try {
      const resampled = resampleTo16k(chunk.samples, chunk.sampleRate);
      const pcm = floatTo16BitPCM(resampled);
      for (const frame of this.chunker.push(pcm)) {
        this.emitFrame(frame);
      }
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private emitFrame(frame: Uint8Array): void {
    const vadResult = this.vad.process(frame);
    const seq = this.frameSeq;
    this.frameSeq += 1;
    for (const listener of this.frameListeners) listener(frame, seq);
    for (const listener of this.vadListeners) listener(vadResult);
  }

  private emitEnd(): void {
    for (const listener of this.endListeners) listener();
  }

  private emitError(err: Error): void {
    if (this.errorListeners.size === 0) return; // avoid silently swallowing with no subscriber
    for (const listener of this.errorListeners) listener(err);
  }
}
