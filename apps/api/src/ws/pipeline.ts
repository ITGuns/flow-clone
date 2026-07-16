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
  filterDictionary,
  toErrorMessage,
  type ASRStream,
  type AppContext,
  type DictionaryEntry,
  type ErrorCode,
  type ErrorMessage,
  type FormatRequest,
  type FormatResult,
  type Formatter,
  type Register,
  type ServerMessage,
  type Timings,
  type UtteranceId,
} from '@undertone/shared';
import type { Plan } from '../routes/session-token';
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

/** What {@link PersistHook} receives at `format.done` (§4.3 fields + §7 columns). No audio. */
export interface PersistHookInput {
  userId: string;
  text: string;
  appName: string;
  register: Register;
  wordCount: number;
}

/** Encrypt-and-store one finalized transcript (Task 3c `persistTranscript`, wired at the gate). */
export type PersistHook = (input: PersistHookInput) => Promise<unknown>;

/** What {@link MeterHook} reports (Task 3f `meterUsage` result). */
export interface MeterHookResult {
  wordsThisWeek: number;
  limit: number;
  /** True once the weekly total has strictly passed the plan cap (§8 `QUOTA_EXCEEDED`). */
  exceeded: boolean;
}

/** Meter `wordCount` words for `userId` on their effective `plan` (Task 3f `meterUsage`). */
export type MeterHook = (userId: string, wordCount: number, plan: Plan) => Promise<MeterHookResult>;

/** Load a user's FULL dictionary for §6 filtering (Task 3d `loadDictionaryForUser`). */
export type LoadDictionaryHook = (userId: string) => Promise<DictionaryEntry[]>;

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
  /** The authenticated user (JWT `sub`). Enables the dictionary/persist/meter hooks. */
  userId?: string;
  /**
   * The connection's EFFECTIVE plan (from the JWT `plan` claim, already resolved by the
   * authenticator — MockAuthenticator/ClerkAuthenticator). Metering derives the weekly cap from it.
   */
  plan?: Plan;
  /** §6: load the user's full dictionary; the pipeline then `filterDictionary`s it per transcript. */
  loadDictionary?: LoadDictionaryHook;
  /** §7: persist the finalized transcript at `format.done` (encrypted; never audio). */
  persist?: PersistHook;
  /** §7/§8: meter words at `format.done`; drives `usage.update` + `QUOTA_EXCEEDED`. */
  meter?: MeterHook;
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
    userId,
    plan,
    loadDictionary,
    persist,
    meter,
  } = params;
  const since = (): number => now() - keyupMs;

  /**
   * Post-format side-effects — run AFTER `format.done` is on the wire on BOTH the success path and
   * the §8 raw-injection fallback, so the user's words are NEVER eaten. Persistence + metering
   * failures degrade silently (the utterance already succeeded); nothing here logs transcript
   * content (§9). Emits `usage.update` (§4.3) and, when the weekly cap is passed, the
   * `QUOTA_EXCEEDED` error frame (§8) — which follows the already-delivered transcript.
   */
  const postFormat = async (text: string, wordCount: number): Promise<void> => {
    if (persist && userId !== undefined) {
      try {
        await persist({
          userId,
          text,
          appName: appContext.appName,
          register: appContext.register,
          wordCount,
        });
      } catch {
        /* degrade: persistence failure never kills a delivered utterance; no content logged */
      }
    }
    if (meter && userId !== undefined && plan !== undefined) {
      try {
        const metered = await meter(userId, wordCount, plan);
        send({ t: 'usage.update', wordsThisWeek: metered.wordsThisWeek, limit: metered.limit });
        if (metered.exceeded) send(wireError('QUOTA_EXCEEDED', utteranceId));
      } catch {
        /* degrade: metering failure never kills a delivered utterance */
      }
    }
  };

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

  // ── Build the FormatRequest (§6). Load the user's FULL dictionary (Task 3d), then apply the
  //    shared §6 `filterDictionary` against the finalized transcript so FormatRequest.dictionary is
  //    "ALREADY capped/filtered" per the §1 contract — and mock + real formatter paths receive the
  //    SAME filtered input (HaikuFormatter re-runs the same filter internally; it is idempotent on
  //    an already-capped set). A dictionary-load failure degrades to an empty dictionary rather
  //    than killing the utterance. ─────────────────────────────────────────────────────────────
  let dictionary: DictionaryEntry[] = [];
  if (loadDictionary && userId !== undefined) {
    try {
      dictionary = filterDictionary(await loadDictionary(userId), transcript);
    } catch {
      dictionary = [];
    }
  }
  const request: FormatRequest = {
    transcript,
    appContext,
    dictionary,
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
    const rawWordCount = countWords(transcript);
    send({
      t: 'format.done',
      utteranceId,
      text: transcript,
      wordCount: rawWordCount,
      timings: buildTimings(tAsrFinal, tPromptBuilt, tFormatTtft, since()),
    });
    machine.reset('idle');
    // The raw words were still delivered → persist + meter them like any other utterance (§7/§8).
    await postFormat(transcript, rawWordCount);
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
  await postFormat(finalText, result.wordCount);
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
