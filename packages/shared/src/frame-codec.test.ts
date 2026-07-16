import { describe, it, expect } from 'vitest';
import {
  FRAME_HEADER_BYTES,
  FRAME_TYPE_AUDIO,
  PROTOCOL_VERSION,
  FrameDecodeError,
  decodeFrame,
  encodeAudioFrame,
} from './frame-codec';

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

function payloadOf(n: number): Uint8Array {
  const p = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) p[i] = i % 256;
  return p;
}

describe('frame-codec round-trip', () => {
  it('encodes then decodes back to the same header fields and payload', () => {
    const payload = payloadOf(640); // 20ms PCM16LE @16kHz mono
    const frame = encodeAudioFrame(7, 42, payload);

    expect(frame.length).toBe(FRAME_HEADER_BYTES + payload.length);

    const decoded = decodeFrame(frame);
    expect(decoded.version).toBe(PROTOCOL_VERSION);
    expect(decoded.type).toBe(FRAME_TYPE_AUDIO);
    expect(decoded.utteranceId).toBe(7);
    expect(decoded.frameSeq).toBe(42);
    expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
  });

  it('writes the header little-endian', () => {
    const frame = encodeAudioFrame(0x0102, 0x03040506, new Uint8Array(0));
    // version, type, u16 LE, u32 LE
    expect(Array.from(frame)).toEqual([0x01, 0x01, 0x02, 0x01, 0x06, 0x05, 0x04, 0x03]);
  });

  it('handles an empty payload', () => {
    const frame = encodeAudioFrame(1, 0, new Uint8Array(0));
    expect(frame.length).toBe(FRAME_HEADER_BYTES);
    const decoded = decodeFrame(frame);
    expect(decoded.payload.length).toBe(0);
    expect(decoded.frameSeq).toBe(0);
  });

  it('decodes correctly when given a subarray view with a non-zero byteOffset', () => {
    const payload = payloadOf(16);
    const inner = encodeAudioFrame(9, 9, payload);
    const outer = new Uint8Array(inner.length + 5);
    outer.set(inner, 5);
    const view = outer.subarray(5); // byteOffset = 5
    const decoded = decodeFrame(view);
    expect(decoded.utteranceId).toBe(9);
    expect(decoded.frameSeq).toBe(9);
    expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
  });
});

describe('frame-codec rejection', () => {
  it('rejects an unknown version', () => {
    const frame = encodeAudioFrame(1, 0, new Uint8Array(2));
    frame[0] = 0x02; // bad version
    expect(() => decodeFrame(frame)).toThrow(FrameDecodeError);
    try {
      decodeFrame(frame);
    } catch (err) {
      expect(err).toBeInstanceOf(FrameDecodeError);
      expect((err as FrameDecodeError).code).toBe('PROTO_ERROR');
    }
  });

  it('rejects an unknown frame type', () => {
    const frame = encodeAudioFrame(1, 0, new Uint8Array(2));
    frame[1] = 0x02; // bad type
    expect(() => decodeFrame(frame)).toThrow(FrameDecodeError);
  });

  it('rejects a buffer shorter than the header', () => {
    expect(() => decodeFrame(new Uint8Array(FRAME_HEADER_BYTES - 1))).toThrow(FrameDecodeError);
  });
});

describe('frame-codec boundary values', () => {
  it('round-trips the u16 max utteranceId', () => {
    const decoded = decodeFrame(encodeAudioFrame(U16_MAX, 0, new Uint8Array(0)));
    expect(decoded.utteranceId).toBe(U16_MAX);
  });

  it('round-trips the u32 max frameSeq', () => {
    const decoded = decodeFrame(encodeAudioFrame(0, U32_MAX, new Uint8Array(0)));
    expect(decoded.frameSeq).toBe(U32_MAX);
  });

  it('throws when utteranceId overflows u16', () => {
    expect(() => encodeAudioFrame(U16_MAX + 1, 0, new Uint8Array(0))).toThrow(RangeError);
  });

  it('throws when frameSeq overflows u32', () => {
    expect(() => encodeAudioFrame(0, U32_MAX + 1, new Uint8Array(0))).toThrow(RangeError);
  });

  it('throws on negative or non-integer header fields', () => {
    expect(() => encodeAudioFrame(-1, 0, new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodeAudioFrame(0, 1.5, new Uint8Array(0))).toThrow(RangeError);
  });
});
