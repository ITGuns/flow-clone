// Binary audio frame codec — CONTRACTS.md §4.2.
// Fixed 8-byte little-endian header, then payload:
//   offset 0  u8   version   = 0x01
//   offset 1  u8   type      = 0x01 (audio)
//   offset 2  u16  utteranceId
//   offset 4  u32  frameSeq  (per-utterance, starts at 0, increments by 1)
//   offset 8  ...  payload   (20ms PCM16LE @16kHz mono = 640 bytes)
// Unknown version/type → server responds `error PROTO_ERROR` and closes 1002.

export const PROTOCOL_VERSION = 0x01;
export const FRAME_TYPE_AUDIO = 0x01;
export const FRAME_HEADER_BYTES = 8;

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

export interface AudioFrame {
  version: number;
  type: number;
  utteranceId: number;
  frameSeq: number;
  payload: Uint8Array;
}

/** Thrown when a frame cannot be decoded. `code` maps directly to the §8 wire error. */
export class FrameDecodeError extends Error {
  readonly code = 'PROTO_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'FrameDecodeError';
  }
}

/** Encode one audio frame. Throws RangeError if the header fields overflow their widths. */
export function encodeAudioFrame(
  utteranceId: number,
  frameSeq: number,
  payload: Uint8Array,
): Uint8Array {
  if (!Number.isInteger(utteranceId) || utteranceId < 0 || utteranceId > U16_MAX) {
    throw new RangeError(`utteranceId out of u16 range [0, ${U16_MAX}]: ${utteranceId}`);
  }
  if (!Number.isInteger(frameSeq) || frameSeq < 0 || frameSeq > U32_MAX) {
    throw new RangeError(`frameSeq out of u32 range [0, ${U32_MAX}]: ${frameSeq}`);
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, FRAME_TYPE_AUDIO);
  view.setUint16(2, utteranceId, true);
  view.setUint32(4, frameSeq, true);
  frame.set(payload, FRAME_HEADER_BYTES);
  return frame;
}

/** Decode one audio frame. Throws FrameDecodeError on short buffer or unknown version/type. */
export function decodeFrame(frame: Uint8Array): AudioFrame {
  if (frame.length < FRAME_HEADER_BYTES) {
    throw new FrameDecodeError(`frame too short: ${frame.length} < ${FRAME_HEADER_BYTES} bytes`);
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const version = view.getUint8(0);
  const type = view.getUint8(1);
  if (version !== PROTOCOL_VERSION) {
    throw new FrameDecodeError(
      `unknown protocol version: 0x${version.toString(16).padStart(2, '0')}`,
    );
  }
  if (type !== FRAME_TYPE_AUDIO) {
    throw new FrameDecodeError(`unknown frame type: 0x${type.toString(16).padStart(2, '0')}`);
  }
  const utteranceId = view.getUint16(2, true);
  const frameSeq = view.getUint32(4, true);
  const payload = frame.subarray(FRAME_HEADER_BYTES);
  return { version, type, utteranceId, frameSeq, payload };
}
