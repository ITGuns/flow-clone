import { describe, it, expect } from 'vitest';
import { floatTo16BitPCM, pcm16Rms, resampleTo16k } from './dsp';
import { constant, ramp, silence, sine } from './test-signals';
import { TARGET_SAMPLE_RATE } from './constants';

describe('resampleTo16k', () => {
  it('is identity (defensive copy) when the input is already 16kHz', () => {
    const input = sine(440, TARGET_SAMPLE_RATE, 320);
    const out = resampleTo16k(input, TARGET_SAMPLE_RATE);
    expect(Array.from(out)).toEqual(Array.from(input));
    // A copy, not the same buffer — mutating the source must not touch the output.
    input[0] = 0.9;
    expect(out[0]).not.toBe(0.9);
  });

  it('downsamples 48kHz → 16kHz by a factor of 3 in length', () => {
    const input = sine(200, 48000, 4800);
    const out = resampleTo16k(input, 48000);
    // 4800 / (48000/16000) = 1600.
    expect(out.length).toBe(1600);
  });

  it('upsamples 8kHz → 16kHz by a factor of 2 in length', () => {
    const input = ramp(0, 1, 100);
    const out = resampleTo16k(input, 8000);
    expect(out.length).toBe(200);
    // Linear interpolation keeps a monotone ramp monotone.
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
    }
  });

  it('returns empty for empty input', () => {
    expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])('throws RangeError on a bad input rate (%s)', (rate) => {
    expect(() => resampleTo16k(sine(440, 16000, 10), rate)).toThrow(RangeError);
  });
});

describe('floatTo16BitPCM', () => {
  it('produces exactly 2 bytes per sample', () => {
    expect(floatTo16BitPCM(new Float32Array(320)).length).toBe(640);
  });

  it('maps 0 → 0, +1 → +32767, -1 → -32768 (little-endian)', () => {
    const bytes = floatTo16BitPCM(Float32Array.of(0, 1, -1));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32767);
    expect(view.getInt16(4, true)).toBe(-32768);
  });

  it('hard-clamps out-of-range samples instead of wrapping', () => {
    const bytes = floatTo16BitPCM(Float32Array.of(2, -2));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});

describe('pcm16Rms', () => {
  it('is 0 for silence and for an empty frame', () => {
    expect(pcm16Rms(floatTo16BitPCM(silence(320)))).toBe(0);
    expect(pcm16Rms(new Uint8Array(0))).toBe(0);
  });

  it('is ~full-scale for a constant full-amplitude signal', () => {
    const rms = pcm16Rms(floatTo16BitPCM(constant(1, 320)));
    expect(rms).toBeGreaterThan(0.99);
    expect(rms).toBeLessThanOrEqual(1);
  });

  it('is ~1/sqrt(2) for a full-scale sine (its known RMS)', () => {
    const rms = pcm16Rms(floatTo16BitPCM(sine(400, 16000, 1600)));
    expect(rms).toBeGreaterThan(0.68);
    expect(rms).toBeLessThan(0.72);
  });

  it('ignores a trailing odd byte rather than reading past the frame', () => {
    const odd = new Uint8Array(641); // 320 samples + 1 stray byte
    expect(() => pcm16Rms(odd)).not.toThrow();
    expect(pcm16Rms(odd)).toBe(0);
  });
});
