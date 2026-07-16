// Synthetic-signal generators shared across the audio tests. Not a test file itself.

/** A sine wave of `samples` length at `freq` Hz, sample rate `rate`, peak amplitude `amp`. */
export function sine(samples: number, freq: number, rate: number, amp = 1): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

/** All-zero (silent) buffer. */
export function silence(samples: number): Float32Array {
  return new Float32Array(samples);
}

/** A linear ramp from `from` to `to` across `samples` (inclusive endpoints). */
export function ramp(samples: number, from = 0, to = 1): Float32Array {
  const out = new Float32Array(samples);
  if (samples === 1) {
    out[0] = from;
    return out;
  }
  for (let i = 0; i < samples; i += 1) {
    out[i] = from + ((to - from) * i) / (samples - 1);
  }
  return out;
}

/** Decode PCM16LE bytes back to normalized floats in [-1, 1] for assertions. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
