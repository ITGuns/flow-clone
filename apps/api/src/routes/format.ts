// POST /v1/format — the browser-native speech path (D-026): the browser's Web Speech API produces a
// raw transcript; this endpoint runs the EXACT post-ASR half of the WS pipeline (ws/pipeline.ts) so
// the result experience matches the streaming path. There is no ASR here — recognition already
// happened client-side — so this is finalize→format→persist→meter without the audio/frames/state
// machine.
//
// Bearer-authenticated behind the same `Authenticator` seam as /v1/me (Clerk in prod, mock keyless).
// Behaviour (mirrors runUtterancePipeline's post-format side-effects):
//   1. filterDictionary(loadDictionary(userId), transcript)  (§6, degrade to [] on load failure)
//   2. formatter.format(...) consumed fully, with the §8 TTFT ceiling
//   3. persistTranscript (§7, encrypted; never audio; degrades silently)
//   4. meterUsage (§7/§8 → usage + exceeded; degrades silently)
// On formatter failure/timeout (§8): respond 200 with the RAW transcript + `unformatted: true`
// ("losing formatting is annoying; losing the user's words is fatal"). An empty transcript
// short-circuits to an empty result with NO persist/meter.
//
// NOTE (contract friction): POST /v1/format is not yet in CONTRACTS.md §5 — reported to the
// orchestrator for ratification (v1.5.0). The request/response shapes below are the proposal.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  UndertoneError,
  filterDictionary,
  toErrorMessage,
  type AppContext,
  type DictionaryEntry,
  type FormatRequest,
  type Formatter,
  type Register,
} from '@undertone/shared';
import {
  FORMAT_TTFT_TIMEOUT_MS,
  countWords,
  type LoadDictionaryHook,
  type MeterHook,
  type PersistHook,
} from '../ws';
import type { AuthedUser, Authenticator } from './session-token';

/** Max transcript length accepted (chars). Over cap → 400. */
export const MAX_TRANSCRIPT_CHARS = 5000;

/** Default request locale (BCP-47) — web v1 is en-US only, matching the WS path. */
const DEFAULT_LOCALE = 'en-US';

/** Every CONTRACTS §1 Register value — used to validate the request's appContext. */
const REGISTERS: readonly Register[] = ['chat', 'email', 'code', 'document', 'terminal', 'unknown'];

/** The `POST /v1/format` request body. */
export interface FormatRequestBody {
  /** Finalized transcript from the browser recognizer (≤ {@link MAX_TRANSCRIPT_CHARS}). */
  transcript: string;
  /** The synthetic web AppContext (register-conditioning + persistence columns). */
  appContext: AppContext;
}

/** The `POST /v1/format` 200 body. */
export interface FormatResponse {
  /** Final formatted text — or, on the §8 fallback, the RAW transcript (see `unformatted`). */
  text: string;
  /** Whitespace-split word count of `text` (the metering unit). */
  wordCount: number;
  /** Which §4.3 grammar commands fired (telemetry; empty on the raw-fallback path). */
  commandsApplied: string[];
  /** Weekly usage after metering — `null` when nothing was metered (empty transcript / no hook). */
  usage: { wordsThisWeek: number; limit: number } | null;
  /** True once the weekly cap was passed (§8 QUOTA_EXCEEDED) — the text is still returned. */
  exceeded: boolean;
  /** Present and true only on the §8 raw-injection fallback (FORMAT_UNAVAILABLE/FORMAT_TIMEOUT). */
  unformatted?: boolean;
}

/** Injected collaborators — the SAME hook instances the WS gateway receives (composition root). */
export interface FormatRouteDeps {
  authenticator: Authenticator;
  formatter: Formatter;
  /** §6: load the user's full dictionary; filtered per-transcript before the prompt. */
  loadDictionary?: LoadDictionaryHook;
  /** §7: persist the finalized transcript (encrypted; never audio). */
  persist?: PersistHook;
  /** §7/§8: meter words → usage + exceeded. */
  meter?: MeterHook;
  /** TTFT ceiling; defaults to the §8 contract value. Lowered in tests to stay fast. */
  ttftTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRegister(value: unknown): value is Register {
  return typeof value === 'string' && (REGISTERS as readonly string[]).includes(value);
}

/** Structural guard for the wire `AppContext` (§1) — register must be a known value. */
function isAppContext(value: unknown): value is AppContext {
  if (!isRecord(value)) return false;
  return (
    typeof value.bundleId === 'string' &&
    typeof value.appName === 'string' &&
    typeof value.windowTitle === 'string' &&
    isRegister(value.register)
  );
}

/** Validate the request body into a typed shape, or return null (→ 400). */
function parseBody(body: unknown): FormatRequestBody | null {
  if (!isRecord(body)) return null;
  const { transcript, appContext } = body;
  if (typeof transcript !== 'string' || transcript.length > MAX_TRANSCRIPT_CHARS) return null;
  if (!isAppContext(appContext)) return null;
  return { transcript, appContext };
}

const TIMEOUT = Symbol('ttft-timeout');

/** Resolve `p`, or {@link TIMEOUT} after `ms` — the §8 TTFT ceiling (mirrors ws/pipeline.ts). */
async function firstWithin<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    const winner = await Promise.race([p, timeout]);
    if (winner === TIMEOUT) void p.catch(() => undefined);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Formatted {
  text: string;
  wordCount: number;
  commandsApplied: string[];
  unformatted: boolean;
}

/**
 * Consume the formatter fully under the TTFT ceiling. On success returns the assembled result; on
 * timeout OR any formatter error, returns the RAW transcript flagged `unformatted` (§8 fallback).
 */
async function formatOrRaw(
  formatter: Formatter,
  request: FormatRequest,
  ttftTimeoutMs: number,
): Promise<Formatted> {
  const controller = new AbortController();
  const gen = formatter.format(request, controller.signal);
  let assembled = '';
  try {
    const first = await firstWithin(gen.next(), ttftTimeoutMs);
    if (first === TIMEOUT) {
      controller.abort();
      throw new UndertoneError('FORMAT_TIMEOUT');
    }
    let step = first;
    while (!step.done) {
      assembled += step.value;
      step = await gen.next();
    }
    const result = step.value;
    return {
      text: result.text !== '' ? result.text : assembled,
      wordCount: result.wordCount,
      commandsApplied: result.commandsApplied,
      unformatted: false,
    };
  } catch {
    controller.abort();
    // §8 raw fallback — never eat the user's words.
    return {
      text: request.transcript,
      wordCount: countWords(request.transcript),
      commandsApplied: [],
      unformatted: true,
    };
  }
}

/** Reply 401 with the WS-style error frame (consistent with /v1/me, POST /v1/session/token). */
function send401(reply: FastifyReply, err: unknown): void {
  const wire =
    err instanceof UndertoneError
      ? toErrorMessage(err)
      : {
          t: 'error' as const,
          code: 'AUTH_INVALID' as const,
          message: 'unauthenticated',
          retryable: false,
        };
  void reply.status(401).send(wire);
}

/**
 * Register `POST /v1/format`. 200 → {@link FormatResponse}; 400 on a bad body; 401 on auth failure.
 * The route degrades gracefully when a hook is absent (skips that step), mirroring the pipeline.
 */
export function registerFormatRoute(app: FastifyInstance, deps: FormatRouteDeps): void {
  const ttftTimeoutMs = deps.ttftTimeoutMs ?? FORMAT_TTFT_TIMEOUT_MS;

  app.post(
    '/v1/format',
    async (req: FastifyRequest, reply: FastifyReply): Promise<FormatResponse | void> => {
      let user: AuthedUser;
      try {
        user = await deps.authenticator.authenticate(req);
      } catch (err) {
        send401(reply, err);
        return;
      }

      const parsed = parseBody(req.body);
      if (!parsed) {
        void reply.status(400).send({ error: 'BAD_BODY', message: 'invalid format request body' });
        return;
      }
      const { transcript, appContext } = parsed;

      // Empty transcript: nothing to format, persist, or meter (never a hollow history row).
      if (transcript.trim() === '') {
        return { text: '', wordCount: 0, commandsApplied: [], usage: null, exceeded: false };
      }

      // §6: load the user's full dictionary, then filter against this transcript. Degrade to [].
      let dictionary: DictionaryEntry[] = [];
      if (deps.loadDictionary) {
        try {
          dictionary = filterDictionary(await deps.loadDictionary(user.userId), transcript);
        } catch {
          dictionary = [];
        }
      }
      const request: FormatRequest = { transcript, appContext, dictionary, locale: DEFAULT_LOCALE };

      const formatted = await formatOrRaw(deps.formatter, request, ttftTimeoutMs);

      // §7: persist the delivered text (formatted OR raw fallback). Failure never eats the result.
      if (deps.persist) {
        try {
          await deps.persist({
            userId: user.userId,
            text: formatted.text,
            appName: appContext.appName,
            register: appContext.register,
            wordCount: formatted.wordCount,
          });
        } catch {
          /* degrade: persistence failure never kills a delivered utterance */
        }
      }

      // §7/§8: meter the delivered words → usage + exceeded. Failure never eats the result.
      let usage: { wordsThisWeek: number; limit: number } | null = null;
      let exceeded = false;
      if (deps.meter) {
        try {
          const metered = await deps.meter(user.userId, formatted.wordCount, user.plan);
          usage = { wordsThisWeek: metered.wordsThisWeek, limit: metered.limit };
          exceeded = metered.exceeded;
        } catch {
          /* degrade: metering failure never kills a delivered utterance */
        }
      }

      return {
        text: formatted.text,
        wordCount: formatted.wordCount,
        commandsApplied: formatted.commandsApplied,
        usage,
        exceeded,
        ...(formatted.unformatted ? { unformatted: true } : {}),
      };
    },
  );
}
