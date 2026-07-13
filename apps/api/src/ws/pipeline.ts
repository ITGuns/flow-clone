// Utterance pipeline — CONTRACTS.md §2 (data flow), §8 (error taxonomy), §9 (timing marks).
//
// Runs the key-release path for ONE utterance: ASR finalize → build FormatRequest → format →
// relay `format.delta`s → `format.done`. Every hop stamps a §9 server timing mark, all measured
// in ms since t_keyup. NOTE (§9 approximation): the server has no key-up event; it uses the
// `audio.end` receipt time as t_keyup. Documented per task.
//
// Failure mapping (§8, exact):
//   AsrTimeoutError          → ASR_TIMEOUT
//   any other ASR failure    → ASR_UNAVAILABLE
//   formatter TTFT > 2000ms  → FORMAT_TIMEOUT   (+ raw-injection fallback)
//   formatter unavailable    → FORMAT_UNAVAILABLE (+ raw-injection fallback)
//
// Raw-injection fallback (§8): for FORMAT_TIMEOUT / FORMAT_UNAVAILABLE we send the `error` frame
// AND a `format.done` carrying the RAW final transcript — "losing formatting is annoying; losing
// the user's words is fatal." commandsApplied semantics: none (no grammar ran); the wire
// `format.done` carries no commandsApplied field, so this is documented, not transmitted.
import {
  AsrTimeoutError,
  ERROR_TAXONOMY,
  UndertoneError,
  toErrorMessage,
  type ASRStream,
  type AppContext,
  type ErrorCode,
  type ErrorMessage,
  type FormatRequest,
  type FormatResult,
  type Formatter,
  type ServerMessage,
  type Timings,
  type UtteranceId,
} from '@undertone/shared';
import { SessionStateMachine } from './state-machine';

/** Contract TTFT ceiling — CONTRACTS.md §8 ("no TTFT within 2000ms" → FORMAT_TIMEOUT). */
export const FORMAT_TTFT_TIMEOUT_MS = 2000;

/**
 * Default backoff for pipeline-originated `requiresBackoff` codes (the ASR_ and FORMAT_ families).
 * §4.3 requires `retryAfterMs` to be present iff the code is `requiresBackoff`; 1c has no adaptive
 * scheduler, so it emits a fixed hint. A Redis/telemetry-driven value replaces this in a later phase.
 */
export const DEFAULT_BACKOFF_MS = 1000;

/** Whitespace-split word count — CONTRACTS.md §1 (`FormatResult.wordCount`, the metering unit). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Build a §4.3 `error` frame, guaranteeing `retryAfterMs` iff the code is `requiresBackoff`. */
export function wireError(
  code: ErrorCode,
  utteranceId?: UtteranceId,
  retryAfterMs?: number,
): ErrorMessage {
  const backoff = ERROR_TAXONOMY[code].requiresBackoff
    ? (retryAfterMs ?? DEFAULT_BACKOFF_MS)
    : undefined;
  return toErrorMessage(
    new UndertoneError(code, undefined, {
      ...(utteranceId !== undefined ? { utteranceId } : {}),
      ...(backoff !== undefined ? { retryAfterMs: backoff } : {}),
    }),
  );
}

export interface PipelineParams {
  utteranceId: UtteranceId;
  asrStream: ASRStream;
  formatter: Formatter;
  /** Per-utterance app context (re-captured on `utterance.start`, §4.3). */
  appContext: AppContext;
  locale: string;
  /** Emit a server→client frame. */
  send: (msg: ServerMessage) => void;
  /** The connection's state machine (advanced on asr.final / format.delta / format.done). */
  machine: SessionStateMachine;
  /** t_keyup baseline in epoch-ms (≈ audio.end receipt). */
  keyupMs: number;
  /** Monotonic-ish clock; defaults to Date.now. Injected for tests. */
  now?: () => number;
  /** TTFT ceiling; defaults to the §8 contract value. Lowered in tests to keep them fast. */
  ttftTimeoutMs?: number;
}

const TIMEOUT = Symbol('ttft-timeout');

async function firstWithin<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    const winner = await Promise.race([p, timeout]);
    // When the timer wins, the discarded generator promise may still reject later (e.g. on abort);
    // swallow it so it never surfaces as an unhandled rejection.
    if (winner === TIMEOUT) void p.catch(() => undefined);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute the finalize→format→done flow for one utterance. Resolves once the terminal frame
 * (`format.done` or a terminal `error`) has been sent; never throws — all failures are mapped
 * onto §8 wire frames.
 */
export async function runUtterancePipeline(params: PipelineParams): Promise<void> {
  const {
    utteranceId,
    asrStream,
    formatter,
    appContext,
    locale,
    send,
    machine,
    keyupMs,
    now = Date.now,
    ttftTimeoutMs = FORMAT_TTFT_TIMEOUT_MS,
  } = params;
  const since = (): number => now() - keyupMs;

  // ── ASR finalize ──────────────────────────────────────────────────────────────────────────
  let transcript: string;
  try {
    transcript = await asrStream.finalize();
  } catch (err) {
    asrStream.close();
    const code: ErrorCode = err instanceof AsrTimeoutError ? 'ASR_TIMEOUT' : 'ASR_UNAVAILABLE';
    machine.toError();
    send(wireError(code, utteranceId));
    machine.reset('idle');
    return;
  }
  const tAsrFinal = since();
  asrStream.close();
  machine.dispatch('asr.final'); // finalizing → formatting
  send({ t: 'transcript.final', utteranceId, text: transcript, asrMs: tAsrFinal });

  // ── Build the FormatRequest (§6). Dictionary is [] in v1 — storage lands in Phase 3; this is
  //    the injection point where the capped/filtered dictionary will be supplied. ───────────────
  const request: FormatRequest = {
    transcript,
    appContext,
    dictionary: [],
    locale,
  };
  const tPromptBuilt = since();

  // ── Format with a TTFT ceiling ──────────────────────────────────────────────────────────────
  const controller = new AbortController();
  const gen = formatter.format(request, controller.signal);
  let tFormatTtft: number | undefined;
  let assembled = '';
  let result: FormatResult | undefined;

  try {
    const first = await firstWithin(gen.next(), ttftTimeoutMs);
    if (first === TIMEOUT) {
      controller.abort();
      throw new UndertoneError('FORMAT_TIMEOUT', undefined, { utteranceId });
    }
    tFormatTtft = since();
    let step = first;
    let firstDelta = true;
    while (!step.done) {
      const delta = step.value;
      assembled += delta;
      if (firstDelta) {
        machine.dispatch('format.delta'); // formatting → injecting
        firstDelta = false;
      }
      send({ t: 'format.delta', utteranceId, text: delta });
      step = await gen.next();
    }
    result = step.value;
  } catch (err) {
    controller.abort();
    const code: ErrorCode =
      err instanceof UndertoneError && err.code === 'FORMAT_TIMEOUT'
        ? 'FORMAT_TIMEOUT'
        : 'FORMAT_UNAVAILABLE';
    // §8 raw-injection fallback: error frame AND a format.done carrying the RAW transcript.
    machine.toError();
    send(wireError(code, utteranceId));
    send({
      t: 'format.done',
      utteranceId,
      text: transcript,
      wordCount: countWords(transcript),
      timings: buildTimings(tAsrFinal, tPromptBuilt, tFormatTtft, since()),
    });
    machine.reset('idle');
    return;
  }

  // ── Success: format.done with the assembled text + §9 marks ─────────────────────────────────
  const finalText = result.text !== '' ? result.text : assembled;
  machine.dispatch('format.done'); // injecting|formatting → idle
  send({
    t: 'format.done',
    utteranceId,
    text: finalText,
    wordCount: result.wordCount,
    timings: buildTimings(tAsrFinal, tPromptBuilt, tFormatTtft, since()),
  });
}

/** Assemble the §9 server marks. Omits t_format_ttft when formatting never produced a token. */
function buildTimings(
  tAsrFinal: number,
  tPromptBuilt: number,
  tFormatTtft: number | undefined,
  tFormatDone: number,
): Timings {
  return {
    t_asr_final: tAsrFinal,
    t_prompt_built: tPromptBuilt,
    ...(tFormatTtft !== undefined ? { t_format_ttft: tFormatTtft } : {}),
    t_format_done: tFormatDone,
  };
}
