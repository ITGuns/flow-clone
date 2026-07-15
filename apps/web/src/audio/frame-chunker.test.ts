import { describe, it, expect } from 'vitest';
import { FrameChunker } from './frame-chunker';
import { FRAME_PAYLOAD_BYTES } from './constants';

const filled = (n: number, value: number): Uint8Array => new Uint8Array(n).fill(value);

describe('FrameChunker', () => {
  it('emits exact 640-byte frames and carries the sub-frame remainder', () => {
    const c = new FrameChunker();
    expect(c.push(filled(FRAME_PAYLOAD_BYTES + 10, 1))).toHaveLength(1);
    expect(c.pendingBytes).toBe(10);
    // Next push completes a second frame from the carried remainder.
    const frames = c.push(filled(FRAME_PAYLOAD_BYTES - 10, 2));
    expect(frames).toHaveLength(1);
    expect(c.pendingBytes).toBe(0);
  });

  it('splits a large run into multiple contiguous frames with no drift', () => {
    const c = new FrameChunker();
    const frames = c.push(filled(FRAME_PAYLOAD_BYTES * 3, 7));
    expect(frames).toHaveLength(3);
    for (const f of frames) expect(f.length).toBe(FRAME_PAYLOAD_BYTES);
  });

  it('returns fresh copies — mutating the input after push never mutates a frame', () => {
    const c = new FrameChunker();
    const input = filled(FRAME_PAYLOAD_BYTES, 5);
    const [frame] = c.push(input);
    input.fill(9);
    expect(frame![0]).toBe(5);
  });

  it('flush() zero-pads the trailing partial frame and then clears it', () => {
    const c = new FrameChunker();
    c.push(filled(100, 3));
    const tail = c.flush();
    expect(tail).not.toBeNull();
    expect(tail!.length).toBe(FRAME_PAYLOAD_BYTES);
    expect(tail![99]).toBe(3);
    expect(tail![100]).toBe(0); // zero padding
    expect(c.flush()).toBeNull(); // nothing left
  });

  it('flush() returns null when there is no remainder', () => {
    expect(new FrameChunker().flush()).toBeNull();
  });

  it('reset() drops the buffered remainder', () => {
    const c = new FrameChunker();
    c.push(filled(100, 1));
    c.reset();
    expect(c.pendingBytes).toBe(0);
    expect(c.flush()).toBeNull();
  });
});
