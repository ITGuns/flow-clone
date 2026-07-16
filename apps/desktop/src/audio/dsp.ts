// Pure DSP primitives — no I/O, no globals, deterministic. Everything here is unit-tested
// with synthetic signals (sine, silence, ramp, step). These are the load-bearing bottom of
// the capture pipeline; the layers above (framing, VAD, AudioCapture) build on them.

import { BYTES_PER_SAMPLE, TARGET_SAMPLE_RATE } from './constants';

const INT16_MAX = 0x7fff; //  32767
const INT16_MIN = -0x8000; // -32768

/**
 * Resample a mono Float32 signal to {@link TARGET_SAMPLE_RATE} (16kHz) using linear
 * interpolation (adequate for v1 — CONTRACTS latency budget assumes cheap client DSP).
 *
 * - Identity fast-path when `inputRate === 16000` (returns a defensive copy).
 * - Empty input → empty output.
 * - Throws {@link RangeError} on a non-finite or non-positive `inputRate` (the "wrong input
 *   rate" failure path — a misconfigured `MicSource` must fail loud, not emit garbage audio).
 */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (!Number.isFinite(inputRate) || inputRate <= 0) {
    throw new RangeError(
      `resampleTo16k: inputRate must be a positive finite number, got ${inputRate}`,
    );
  }
  if (input.length === 0) {
    return new Float32Array(0);
  }
  if (inputRate === TARGET_SAMPLE_RATE) {
    return input.slice();
  }

  const ratio = inputRate / TARGET_SAMPLE_RATE; // input samples consumed per output sample
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  const lastIndex = input.length - 1;

  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, lastIndex);
    const frac = srcPos - i0;
    const a = input[i0] ?? 0;
    const b = input[i1] ?? 0;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

/**
 * Convert a mono Float32 signal in [-1, 1] to little-endian PCM16 bytes. Out-of-range samples
 * are hard-clamped (never wrapped). Output length is exactly `input.length * 2`.
 */
export function floatTo16BitPCM(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * BYTES_PER_SAMPLE);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i += 1) {
    const s = input[i] ?? 0;
    const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
    // Asymmetric scaling: negative range reaches -32768, positive reaches +32767.
    const value = clamped < 0 ? Math.round(clamped * -INT16_MIN) : Math.round(clamped * INT16_MAX);
    const bounded = value < INT16_MIN ? INT16_MIN : value > INT16_MAX ? INT16_MAX : value;
    view.setInt16(i * BYTES_PER_SAMPLE, bounded, true);
  }
  return out;
}

/**
 * Root-mean-square energy of a PCM16LE frame, normalized to [0, 1] (full-scale = 1.0).
 * Trailing odd byte (if any) is ignored. Empty frame → 0.
 */
export function pcm16Rms(frame: Uint8Array): number {
  const sampleCount = Math.floor(frame.byteLength / BYTES_PER_SAMPLE);
  if (sampleCount === 0) return 0;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = view.getInt16(i * BYTES_PER_SAMPLE, true) / -INT16_MIN; // normalize by 32768
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return rms < 0 ? 0 : rms > 1 ? 1 : rms;
}
