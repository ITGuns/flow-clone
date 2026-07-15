import { describe, it, expect } from 'vitest';
import { AudioCapture } from './audio-capture';
import { FakeMicSource } from './mic-source';
import { constant } from './test-signals';
import { FRAME_PAYLOAD_BYTES, TARGET_SAMPLE_RATE } from './constants';

describe('AudioCapture', () => {
  it('emits contiguous 640-byte frames with a monotonic frameSeq starting at 0', async () => {
    // 640 samples @16kHz → 640 PCM16 samples → 1280 bytes → 2 whole frames.
    const source = new FakeMicSource(constant(0.3, 640), TARGET_SAMPLE_RATE);
    const capture = new AudioCapture({ source });
    const frames: { seq: number; len: number }[] = [];
    capture.onFrame((frame, seq) => frames.push({ seq, len: frame.length }));

    await capture.start();
    expect(frames.map((f) => f.seq)).toEqual([0, 1]);
    for (const f of frames) expect(f.len).toBe(FRAME_PAYLOAD_BYTES);
  });

  it('flushes a zero-padded tail frame and fires onEnd on stop', async () => {
    // 500 samples → 1000 bytes → 1 whole frame + 360-byte remainder flushed on stop.
    const source = new FakeMicSource(constant(0.3, 500), TARGET_SAMPLE_RATE);
    const capture = new AudioCapture({ source });
    let frameCount = 0;
    let ended = false;
    capture.onFrame(() => (frameCount += 1));
    capture.onEnd(() => (ended = true));

    await capture.start();
    expect(frameCount).toBe(1);
    await capture.stop();
    expect(frameCount).toBe(2); // tail flushed
    expect(ended).toBe(true);
  });

  it('drives the VAD so a loud signal reports speaking', async () => {
    const source = new FakeMicSource(constant(0.5, 320), TARGET_SAMPLE_RATE);
    const capture = new AudioCapture({ source });
    const levels: number[] = [];
    let sawSpeaking = false;
    capture.onVad((r) => {
      levels.push(r.level);
      if (r.speaking) sawSpeaking = true;
    });
    await capture.start();
    expect(sawSpeaking).toBe(true);
    expect(levels[0]!).toBeGreaterThan(0.4);
  });

  it('surfaces a bad input rate through onError instead of throwing', async () => {
    const source = new FakeMicSource(constant(0.3, 320), -1);
    const capture = new AudioCapture({ source });
    const errors: Error[] = [];
    capture.onError((e) => errors.push(e));
    await capture.start();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
  });

  it('is single-use: a second start throws', async () => {
    const capture = new AudioCapture({ source: new FakeMicSource(constant(0.3, 320), 16000) });
    await capture.start();
    await capture.stop();
    await expect(capture.start()).rejects.toThrow(/single-use/);
  });

  it('stop before start throws', async () => {
    const capture = new AudioCapture({ source: new FakeMicSource(constant(0.3, 320), 16000) });
    await expect(capture.stop()).rejects.toThrow(/not started/);
  });
});
