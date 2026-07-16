// Mirrored from apps/desktop/src/audio — keep in sync (dedupe tracked in DECISIONS D-023)
//
// Energy-based voice activity detector for the live level display. Pure and per-frame: give it a
// 640-byte PCM16LE frame, get back {level, speaking}. `level` drives the mic meter; `speaking` is
// RMS-threshold gated with a hangover tail so brief inter-word gaps don't flicker the state.
//
// This is a display/UX signal, NOT an endpointer — ASR (server-side) owns utterance finalization
// per CONTRACTS §4.3 (`audio.end` on release). VAD here never gates what is sent.

import { pcm16Rms } from './dsp';

export interface VadResult {
  /** RMS energy of the frame, normalized to [0, 1]. Feeds the mic meter directly. */
  level: number;
  /** True while voice is considered active (threshold + hangover). */
  speaking: boolean;
}

export interface EnergyVADOptions {
  /** RMS activation threshold in [0, 1]. Default 0.015 (~ -36 dBFS). */
  threshold?: number;
  /** Frames to hold `speaking` after energy drops below threshold. Default 5 (~100ms). */
  hangoverFrames?: number;
}

const DEFAULT_THRESHOLD = 0.015;
const DEFAULT_HANGOVER_FRAMES = 5;

export class EnergyVAD {
  private readonly threshold: number;
  private readonly hangoverFrames: number;
  private hangoverRemaining = 0;

  constructor(options: EnergyVADOptions = {}) {
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const hangoverFrames = options.hangoverFrames ?? DEFAULT_HANGOVER_FRAMES;
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new RangeError(
        `EnergyVAD: threshold must be a non-negative finite number, got ${threshold}`,
      );
    }
    if (!Number.isInteger(hangoverFrames) || hangoverFrames < 0) {
      throw new RangeError(
        `EnergyVAD: hangoverFrames must be a non-negative integer, got ${hangoverFrames}`,
      );
    }
    this.threshold = threshold;
    this.hangoverFrames = hangoverFrames;
  }

  /** Score one PCM16LE frame. Advances internal hangover state. */
  process(frame: Uint8Array): VadResult {
    const level = pcm16Rms(frame);
    let speaking: boolean;
    if (level >= this.threshold) {
      this.hangoverRemaining = this.hangoverFrames;
      speaking = true;
    } else if (this.hangoverRemaining > 0) {
      this.hangoverRemaining -= 1;
      speaking = true;
    } else {
      speaking = false;
    }
    return { level, speaking };
  }

  /** Clear hangover state (used when a capture restarts). */
  reset(): void {
    this.hangoverRemaining = 0;
  }
}
