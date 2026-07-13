// Audio pipeline constants — derived from CONTRACTS.md §4.2.
// A frame is 20ms of PCM16LE @ 16kHz mono:
//   16000 samples/s * 0.02s = 320 samples; 320 * 2 bytes = 640 bytes.
// These numbers are law; the WS client (task 1b) consumes exactly 640-byte payloads.

/** ASR ingest sample rate — CONTRACTS §2.1 `ASRStreamOptions.sampleRate`. */
export const TARGET_SAMPLE_RATE = 16000;

/** Frame duration in milliseconds — CONTRACTS §4.2 ("20ms PCM16LE"). */
export const FRAME_DURATION_MS = 20;

/** Samples per 20ms frame at the target rate (16000 * 0.02 = 320). */
export const SAMPLES_PER_FRAME = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000;

/** Bytes per frame: 320 PCM16 samples * 2 bytes = 640 — CONTRACTS §4.2. */
export const FRAME_PAYLOAD_BYTES = SAMPLES_PER_FRAME * 2;

/** Bytes per PCM16 sample. */
export const BYTES_PER_SAMPLE = 2;
