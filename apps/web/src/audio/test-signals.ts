// Synthetic mono Float32 signal generators for the DSP unit tests. Pure, deterministic — no
// randomness, so assertions are stable. Not a `.test` file; imported only by the audio suites.

/** A full-scale sine wave: `sampleCount` samples of `freq` Hz at `rate` Hz, amplitude in [0,1]. */
export function sine(freq: number, rate: number, sampleCount: number, amplitude = 1): Float32Array {
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

/** Constant silence (all zeros). */
export function silence(sampleCount: number): Float32Array {
  return new Float32Array(sampleCount);
}

/** A linear ramp from `from` to `to` across `sampleCount` samples (inclusive of both ends). */
export function ramp(from: number, to: number, sampleCount: number): Float32Array {
  const out = new Float32Array(sampleCount);
  if (sampleCount === 1) {
    out[0] = from;
    return out;
  }
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = from + ((to - from) * i) / (sampleCount - 1);
  }
  return out;
}

/** A constant-value buffer (used to build a known-RMS frame). */
export function constant(value: number, sampleCount: number): Float32Array {
  return new Float32Array(sampleCount).fill(value);
}
