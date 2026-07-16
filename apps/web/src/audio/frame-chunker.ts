// Mirrored from apps/desktop/src/audio — keep in sync (dedupe tracked in DECISIONS D-023)
//
// Stateful byte-framer — CONTRACTS.md §4.2. Accepts arbitrary-length PCM16LE byte runs and emits
// exact 640-byte frames, carrying any sub-frame remainder across calls so the frame grid never
// drifts (the WS client needs contiguous frames, no gaps). Emitted frames are always fresh copies —
// mutating the caller's input after `push` never mutates a frame.

import { FRAME_PAYLOAD_BYTES } from './constants';

export class FrameChunker {
  private remainder = new Uint8Array(0);

  /** Feed bytes; returns zero or more complete {@link FRAME_PAYLOAD_BYTES}-byte frames. */
  push(bytes: Uint8Array): Uint8Array[] {
    if (bytes.length === 0 && this.remainder.length < FRAME_PAYLOAD_BYTES) {
      return [];
    }
    const combined = new Uint8Array(this.remainder.length + bytes.length);
    combined.set(this.remainder, 0);
    combined.set(bytes, this.remainder.length);

    const frames: Uint8Array[] = [];
    let offset = 0;
    while (combined.length - offset >= FRAME_PAYLOAD_BYTES) {
      frames.push(combined.slice(offset, offset + FRAME_PAYLOAD_BYTES));
      offset += FRAME_PAYLOAD_BYTES;
    }
    this.remainder = combined.slice(offset);
    return frames;
  }

  /**
   * Emit the trailing partial frame zero-padded to {@link FRAME_PAYLOAD_BYTES}, then clear it.
   * Returns `null` when there is no remainder (nothing to flush). Called by capture stop.
   */
  flush(): Uint8Array | null {
    if (this.remainder.length === 0) return null;
    const frame = new Uint8Array(FRAME_PAYLOAD_BYTES); // zero-filled → tail padding
    frame.set(this.remainder, 0);
    this.remainder = new Uint8Array(0);
    return frame;
  }

  /** Bytes held back awaiting a full frame. */
  get pendingBytes(): number {
    return this.remainder.length;
  }

  /** Drop any buffered remainder (used when a capture restarts its counters). */
  reset(): void {
    this.remainder = new Uint8Array(0);
  }
}
