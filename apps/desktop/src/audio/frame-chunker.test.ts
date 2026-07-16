import { describe, it, expect } from 'vitest';
import { FrameChunker } from './frame-chunker';
import { FRAME_PAYLOAD_BYTES } from './constants';

function counting(n: number, start = 0): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) b[i] = (start + i) % 256;
  return b;
}

describe('FrameChunker', () => {
  it('emits one exact frame for exactly one frame of bytes, with no remainder', () => {
    const c = new FrameChunker();
    const frames = c.push(counting(FRAME_PAYLOAD_BYTES));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.length).toBe(FRAME_PAYLOAD_BYTES);
    expect(c.pendingBytes).toBe(0);
  });

  it('carries a sub-frame remainder across pushes', () => {
    const c = new FrameChunker();
    expect(c.push(counting(FRAME_PAYLOAD_BYTES - 1))).toHaveLength(0);
    expect(c.pendingBytes).toBe(FRAME_PAYLOAD_BYTES - 1);
    const frames = c.push(counting(1, FRAME_PAYLOAD_BYTES - 1));
    expect(frames).toHaveLength(1);
    expect(c.pendingBytes).toBe(0);
  });

  it('splits a multi-frame push and keeps the leftover', () => {
    const c = new FrameChunker();
    const frames = c.push(counting(FRAME_PAYLOAD_BYTES * 2 + 320));
    expect(frames).toHaveLength(2);
    expect(c.pendingBytes).toBe(320);
  });

  it('preserves byte order across a fragmented stream (no gaps, no reordering)', () => {
    const c = new FrameChunker();
    const total = FRAME_PAYLOAD_BYTES * 2;
    const collected: number[] = [];
    // Feed the 0..255 repeating stream in irregular chunk sizes.
    let sent = 0;
    for (const size of [10, 300, 640, 1, 200, 5000]) {
      const take = Math.min(size, total - sent);
      if (take <= 0) break;
      for (const frame of c.push(counting(take, sent % 256))) {
        collected.push(...Array.from(frame));
      }
      sent += take;
    }
    const expected = Array.from(counting(FRAME_PAYLOAD_BYTES * 2));
    expect(collected).toEqual(expected);
  });

  it('emits nothing for an empty push with no pending bytes', () => {
    const c = new FrameChunker();
    expect(c.push(new Uint8Array(0))).toHaveLength(0);
  });

  it('flush zero-pads the remainder to a full frame and clears it', () => {
    const c = new FrameChunker();
    c.push(counting(100));
    const tail = c.flush();
    expect(tail).not.toBeNull();
    expect(tail?.length).toBe(FRAME_PAYLOAD_BYTES);
    // First 100 bytes are data; the rest is zero padding.
    expect(Array.from(tail!.subarray(0, 100))).toEqual(Array.from(counting(100)));
    expect(Array.from(tail!.subarray(100))).toEqual(new Array(FRAME_PAYLOAD_BYTES - 100).fill(0));
    expect(c.pendingBytes).toBe(0);
  });

  it('flush returns null when there is no remainder', () => {
    const c = new FrameChunker();
    c.push(counting(FRAME_PAYLOAD_BYTES));
    expect(c.flush()).toBeNull();
  });

  it('emits independent copies (mutating the source after push does not alter a frame)', () => {
    const c = new FrameChunker();
    const src = counting(FRAME_PAYLOAD_BYTES);
    const [frame] = c.push(src);
    src.fill(0xff);
    expect(frame?.[0]).toBe(0);
  });
});
