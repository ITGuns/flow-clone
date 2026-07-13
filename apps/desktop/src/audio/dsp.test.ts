import { describe, it, expect } from 'vitest';
import { resampleTo16k, floatTo16BitPCM, pcm16Rms } from './dsp';
import { ramp, sine, silence, pcm16ToFloat } from './test-signals';

describe('resampleTo16k', () => {
  it('is an identity (defensive copy) when input is already 16kHz', () => {
    const input = sine(320, 440, 16000, 0.5);
    const out = resampleTo16k(input, 16000);
    expect(out).not.toBe(input); // copy, not the same reference
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it('downsamples 48kHz to ~1/3 the sample count', () => {
    const input = sine(4800, 200, 48000, 0.8);
    const out = resampleTo16k(input, 48000);
    expect(out.length).toBe(1600); // 4800 * 16000/48000
  });

  it('upsamples 8kHz to ~2x the sample count', () => {
    const input = ramp(100, 0, 1);
    const out = resampleTo16k(input, 8000);
    expect(out.length).toBe(200);
  });

  it('preserves a linear ramp under interpolation (endpoints and midpoint)', () => {
    const input = ramp(1000, 0, 1);
    const out = resampleTo16k(input, 48000); // → ~333 samples
    expect(out[0]).toBeCloseTo(0, 5);
    const mid = out[Math.floor(out.length / 2)] ?? NaN;
    expect(mid).toBeCloseTo(0.5, 2);
  });

  it('returns empty for empty input', () => {
    expect(resampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });

  it('throws RangeError on a non-positive or non-finite input rate (wrong-rate failure path)', () => {
    const input = sine(320, 440, 16000);
    expect(() => resampleTo16k(input, 0)).toThrow(RangeError);
    expect(() => resampleTo16k(input, -48000)).toThrow(RangeError);
    expect(() => resampleTo16k(input, Number.NaN)).toThrow(RangeError);
    expect(() => resampleTo16k(input, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('floatTo16BitPCM', () => {
  it('produces exactly 2 bytes per sample', () => {
    expect(floatTo16BitPCM(new Float32Array(320)).length).toBe(640);
  });

  it('maps known amplitudes to little-endian PCM16', () => {
    const bytes = floatTo16BitPCM(new Float32Array([0, 1, -1]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32767); // +1.0 → INT16_MAX
    expect(view.getInt16(4, true)).toBe(-32768); // -1.0 → INT16_MIN
  });

  it('hard-clamps out-of-range samples instead of wrapping', () => {
    const bytes = floatTo16BitPCM(new Float32Array([2, -2]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });

  it('round-trips a sine within quantization error', () => {
    const input = sine(320, 440, 16000, 0.5);
    const decoded = pcm16ToFloat(floatTo16BitPCM(input));
    for (let i = 0; i < input.length; i += 1) {
      expect(decoded[i]).toBeCloseTo(input[i] ?? 0, 3);
    }
  });
});

describe('pcm16Rms', () => {
  it('is 0 for silence', () => {
    expect(pcm16Rms(floatTo16BitPCM(silence(320)))).toBeCloseTo(0, 6);
  });

  it('is ~0.707 * amplitude for a full sine', () => {
    const rms = pcm16Rms(floatTo16BitPCM(sine(1600, 300, 16000, 1)));
    expect(rms).toBeCloseTo(0.707, 2);
  });

  it('scales with amplitude', () => {
    const loud = pcm16Rms(floatTo16BitPCM(sine(1600, 300, 16000, 0.8)));
    const quiet = pcm16Rms(floatTo16BitPCM(sine(1600, 300, 16000, 0.2)));
    expect(loud).toBeGreaterThan(quiet);
  });

  it('returns 0 for an empty frame', () => {
    expect(pcm16Rms(new Uint8Array(0))).toBe(0);
  });
});
