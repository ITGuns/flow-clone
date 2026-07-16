// The hardware boundary. `MicSource` is the ONLY seam in this module that touches real audio
// I/O; everything above it (resample, framing, VAD, AudioCapture) is pure and unit-tested.
// `WebAudioMicSource` (getUserMedia + AudioWorklet) is deliberately NOT unit-tested — it needs
// a real mic and browser audio graph — and is verified via HUMAN_TODO manual scripts / E2E.
// `FakeMicSource` plays Float32 fixtures so the whole pipeline above is testable on any OS.

/** One buffer of mono float samples plus the rate it was captured at. */
export interface MicChunk {
  readonly samples: Float32Array;
  /** Capture sample rate in Hz (e.g. 48000). Resampled to 16kHz downstream. */
  readonly sampleRate: number;
}

export interface MicSource {
  /** Begin capture. `onChunk` fires for each buffer until `stop`. Resolves once capturing. */
  start(onChunk: (chunk: MicChunk) => void): Promise<void>;
  /** Stop capture and release the device. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Deterministic {@link MicSource} for tests and future E2E. Constructed with fixed-rate
 * fixtures that are replayed synchronously on `start`, or driven manually via `emit`.
 */
export class FakeMicSource implements MicSource {
  private readonly fixtures: readonly Float32Array[];
  private readonly sampleRate: number;
  private onChunk: ((chunk: MicChunk) => void) | null = null;
  private started = false;

  /**
   * @param fixtures  One or more mono Float32 buffers to replay on `start`. Pass `[]` and use
   *                  `emit` for manual, step-by-step control.
   * @param sampleRate  Rate the fixtures are sampled at.
   */
  constructor(fixtures: Float32Array | readonly Float32Array[], sampleRate: number) {
    this.fixtures = fixtures instanceof Float32Array ? [fixtures] : fixtures;
    this.sampleRate = sampleRate;
  }

  start(onChunk: (chunk: MicChunk) => void): Promise<void> {
    if (this.started) {
      return Promise.reject(new Error('FakeMicSource.start: already started'));
    }
    this.started = true;
    this.onChunk = onChunk;
    for (const samples of this.fixtures) {
      onChunk({ samples, sampleRate: this.sampleRate });
    }
    return Promise.resolve();
  }

  /** Push one more buffer at the fixed rate. No-op if not started or already stopped. */
  emit(samples: Float32Array): void {
    if (this.started && this.onChunk) {
      this.onChunk({ samples, sampleRate: this.sampleRate });
    }
  }

  stop(): Promise<void> {
    this.started = false;
    this.onChunk = null;
    return Promise.resolve();
  }
}

// The AudioWorklet processor, shipped as a source string and loaded from a Blob URL so it does
// not need its own build step. Runs on the audio render thread; posts a copy of each 128-sample
// render quantum (mono, channel 0) back to the main thread. `AudioWorkletProcessor` /
// `registerProcessor` are audio-thread globals, so this stays a string — never typechecked TS.
const CAPTURE_WORKLET_SOURCE = `
class UndertoneCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0].slice());
    }
    return true;
  }
}
registerProcessor('undertone-capture', UndertoneCaptureProcessor);
`;

/**
 * Real renderer mic capture via getUserMedia + AudioWorklet. Isolated and NOT unit-tested
 * (requires hardware + a browser audio graph). Emits chunks at the AudioContext's native rate;
 * the pipeline resamples to 16kHz. Verified through HUMAN_TODO manual scripts and E2E.
 */
export class WebAudioMicSource implements MicSource {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private moduleUrl: string | null = null;

  async start(onChunk: (chunk: MicChunk) => void): Promise<void> {
    if (this.context) throw new Error('WebAudioMicSource.start: already started');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.stream = stream;

    const context = new AudioContext();
    this.context = context;

    const blob = new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' });
    const moduleUrl = URL.createObjectURL(blob);
    this.moduleUrl = moduleUrl;
    await context.audioWorklet.addModule(moduleUrl);

    const sourceNode = context.createMediaStreamSource(stream);
    this.sourceNode = sourceNode;

    const workletNode = new AudioWorkletNode(context, 'undertone-capture');
    this.workletNode = workletNode;
    workletNode.port.onmessage = (event: MessageEvent): void => {
      const samples = event.data as Float32Array;
      onChunk({ samples, sampleRate: context.sampleRate });
    };

    sourceNode.connect(workletNode);
    // The worklet is a passive tap; do not connect to the destination (no monitoring playback).
  }

  async stop(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.moduleUrl) {
      URL.revokeObjectURL(this.moduleUrl);
      this.moduleUrl = null;
    }
  }
}
