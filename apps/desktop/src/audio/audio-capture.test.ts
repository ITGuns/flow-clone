import { describe, it, expect } from 'vitest';
import { AudioCapture } from './audio-capture';
import { FakeMicSource } from './mic-source';
import { FRAME_PAYLOAD_BYTES } from './constants';
import { sine, silence } from './test-signals';
import type { VadResult } from './vad';

interface Collected {
  frames: Uint8Array[];
  seqs: number[];
  vad: VadResult[];
  ended: number;
  errors: Error[];
}

function collect(capture: AudioCapture): Collected {
  const c: Collected = { frames: [], seqs: [], vad: [], ended: 0, errors: [] };
  capture.onFrame((frame, seq) => {
    c.frames.push(frame);
    c.seqs.push(seq);
  });
  capture.onVad((r) => c.vad.push(r));
  capture.onEnd(() => (c.ended += 1));
  capture.onError((e) => c.errors.push(e));
  return c;
}

describe('AudioCapture', () => {
  it('emits ordered 640-byte frames with contiguous seqs and one VAD event each', async () => {
    // 3200 samples @ 16kHz → 6400 bytes → exactly 10 frames, no remainder.
    const src = new FakeMicSource(sine(3200, 300, 16000, 0.5), 16000);
    const capture = new AudioCapture({ source: src });
    const c = collect(capture);

    await capture.start();
    await capture.stop();

    expect(c.frames).toHaveLength(10);
    for (const f of c.frames) expect(f.length).toBe(FRAME_PAYLOAD_BYTES);
    expect(c.seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(c.vad).toHaveLength(10);
    expect(c.ended).toBe(1);
    expect(c.errors).toHaveLength(0);
  });

  it('resamples a 48kHz source and still emits 640-byte frames', async () => {
    const src = new FakeMicSource(sine(9600, 300, 48000, 0.5), 48000);
    const capture = new AudioCapture({ source: src });
    const c = collect(capture);
    await capture.start();
    await capture.stop();
    expect(c.frames.length).toBeGreaterThan(0);
    for (const f of c.frames) expect(f.length).toBe(FRAME_PAYLOAD_BYTES);
    // seqs are contiguous from 0
    expect(c.seqs).toEqual(c.seqs.map((_, i) => i));
  });

  it('flushes a zero-padded trailing frame on stop, then emits end exactly once', async () => {
    // 800 samples → 1600 bytes → 2 full frames (1280) + 320 remainder → 1 padded tail = 3 frames.
    const src = new FakeMicSource(sine(800, 300, 16000, 0.5), 16000);
    const capture = new AudioCapture({ source: src });
    const c = collect(capture);
    await capture.start();
    await capture.stop();

    expect(c.frames).toHaveLength(3);
    expect(c.seqs).toEqual([0, 1, 2]);
    const tail = c.frames[2]!;
    expect(tail.length).toBe(FRAME_PAYLOAD_BYTES);
    // Last 320 bytes (160 samples) of the tail are zero padding.
    expect(Array.from(tail.subarray(320))).toEqual(new Array(320).fill(0));
    expect(c.ended).toBe(1);
  });

  it('marks speaking frames for a loud signal', async () => {
    const src = new FakeMicSource(sine(3200, 300, 16000, 0.6), 16000);
    const capture = new AudioCapture({ source: src });
    const c = collect(capture);
    await capture.start();
    await capture.stop();
    expect(c.vad.every((v) => v.speaking)).toBe(true);
    expect(c.vad.every((v) => v.level > 0)).toBe(true);
  });

  it('handles an empty buffer without emitting frames, still ends cleanly', async () => {
    const src = new FakeMicSource(silence(0), 16000); // empty Float32Array
    const capture = new AudioCapture({ source: src });
    const c = collect(capture);
    await capture.start();
    await capture.stop();
    expect(c.frames).toHaveLength(0);
    expect(c.ended).toBe(1);
    expect(c.errors).toHaveLength(0);
  });

  it('emits an error event on a bad input rate (wrong-rate failure path)', async () => {
    const src = new FakeMicSource(sine(320, 300, 16000, 0.5), 0); // invalid rate
    const capture = new AudioCapture({ source: src });
    const c = collect(capture);
    await capture.start();
    await capture.stop();
    expect(c.errors.length).toBeGreaterThan(0);
    expect(c.errors[0]).toBeInstanceOf(RangeError);
    expect(c.frames).toHaveLength(0);
  });

  it('rejects stop before start (stop-without-start failure path)', async () => {
    const capture = new AudioCapture({ source: new FakeMicSource([], 16000) });
    await expect(capture.stop()).rejects.toThrow(/not started/);
  });

  it('rejects a double start', async () => {
    const capture = new AudioCapture({ source: new FakeMicSource([], 16000) });
    await capture.start();
    await expect(capture.start()).rejects.toThrow(/already started/);
    await capture.stop();
  });

  it('rejects restart after stop (single-use)', async () => {
    const capture = new AudioCapture({ source: new FakeMicSource([], 16000) });
    await capture.start();
    await capture.stop();
    await expect(capture.start()).rejects.toThrow(/single-use/);
  });

  it('unsubscribe stops further callbacks', async () => {
    const src = new FakeMicSource([], 16000);
    const capture = new AudioCapture({ source: src });
    let count = 0;
    const off = capture.onFrame(() => (count += 1));
    await capture.start();
    src.emit(sine(320, 300, 16000, 0.5)); // one frame
    off();
    src.emit(sine(320, 300, 16000, 0.5)); // second frame, no longer observed
    await capture.stop();
    expect(count).toBe(1);
  });
});
