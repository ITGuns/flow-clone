// HaikuFormatter — CONTRACTS.md §2.2 / §6 / §8. The real formatting service: one streaming
// Claude Haiku call per utterance. Builds the frozen system prompt from the §4.3 grammar plus
// the register and the §6-filtered dictionary, streams text deltas, and maps provider trouble
// onto the two locally-defined errors the gateway turns into §8 wire codes:
//   FormatTimeoutError     → FORMAT_TIMEOUT     (no TTFT within 2000ms)
//   FormatUnavailableError → FORMAT_UNAVAILABLE (connect/5xx/refusal)
// NEVER logs transcript content.
import Anthropic from '@anthropic-ai/sdk';
import {
  filterDictionary,
  type Formatter,
  type FormatRequest,
  type FormatResult,
} from '@undertone/shared';
import { buildSystemPrompt } from './prompt';

/** Model / decoding parameters are fixed by ARCHITECTURE §4 — a bigger model here is a bug. */
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const HAIKU_MAX_TOKENS = 1024;
export const HAIKU_TEMPERATURE = 0;
/** Time-to-first-token budget; exceeding it is FORMAT_TIMEOUT (§8, ARCHITECTURE §4 hop 5). */
export const HAIKU_TTFT_MS = 2000;

/** No time-to-first-token within the budget. Gateway maps to §8 FORMAT_TIMEOUT. */
export class FormatTimeoutError extends Error {
  constructor(message = `no time-to-first-token within ${HAIKU_TTFT_MS}ms`) {
    super(message);
    this.name = 'FormatTimeoutError';
  }
}

/** Provider connect/5xx or a model refusal. Gateway maps to §8 FORMAT_UNAVAILABLE. */
export class FormatUnavailableError extends Error {
  constructor(message = 'formatting provider unavailable', options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'FormatUnavailableError';
  }
}

/** Input to the injectable stream factory. `signal` aborts the underlying provider call. */
export interface HaikuStreamInput {
  system: string;
  transcript: string;
  signal: AbortSignal;
}

/**
 * A chunk from the provider stream: incremental text deltas, then exactly one terminal `done`
 * carrying the stop reason. Tests inject a fake factory; the default wraps the Anthropic SDK.
 */
export type HaikuChunk =
  { type: 'text'; text: string } | { type: 'done'; stopReason: string | null };

export type HaikuStreamFactory = (input: HaikuStreamInput) => AsyncIterable<HaikuChunk>;

export interface HaikuFormatterOptions {
  /** Inject a fake stream for tests. When omitted, `client` (or a default) drives the SDK. */
  streamFactory?: HaikuStreamFactory;
  /** Anthropic client for the default factory. Ignored when `streamFactory` is provided. */
  client?: Anthropic;
  /** Override the TTFT budget (tests). */
  ttftMs?: number;
}

/** Whitespace-split word count — the §1 metering unit. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Derive a child AbortController that aborts on the external signal or on our own timeout. */
function linkAbort(external: AbortSignal): AbortController {
  const controller = new AbortController();
  if (external.aborted) {
    controller.abort(external.reason);
  } else {
    external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
  }
  return controller;
}

/** Default stream factory: adapts the Anthropic streaming SDK to HaikuChunk. */
export function anthropicStreamFactory(client: Anthropic): HaikuStreamFactory {
  return async function* stream(input: HaikuStreamInput): AsyncIterable<HaikuChunk> {
    const messageStream = client.messages.stream(
      {
        model: HAIKU_MODEL,
        max_tokens: HAIKU_MAX_TOKENS,
        temperature: HAIKU_TEMPERATURE,
        system: input.system,
        messages: [{ role: 'user', content: input.transcript }],
      },
      { signal: input.signal },
    );
    for await (const event of messageStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }
    const final = await messageStream.finalMessage();
    yield { type: 'done', stopReason: final.stop_reason };
  };
}

export class HaikuFormatter implements Formatter {
  private readonly streamFactory: HaikuStreamFactory;
  private readonly ttftMs: number;

  constructor(options: HaikuFormatterOptions = {}) {
    if (options.streamFactory) {
      this.streamFactory = options.streamFactory;
    } else {
      const client = options.client ?? new Anthropic();
      this.streamFactory = anthropicStreamFactory(client);
    }
    this.ttftMs = options.ttftMs ?? HAIKU_TTFT_MS;
  }

  /** Race the first chunk against the TTFT budget; a timeout throws FormatTimeoutError. */
  private async firstChunk(
    iterator: AsyncIterator<HaikuChunk>,
  ): Promise<IteratorResult<HaikuChunk>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new FormatTimeoutError()), this.ttftMs);
    });
    try {
      return await Promise.race([iterator.next(), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async *format(req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();

    // §6: filter the dictionary against the transcript before building the prompt, so the
    // prompt only carries entries that fit the cap / fuzzy-match the utterance.
    const dictionary = filterDictionary(req.dictionary, req.transcript);
    const system = buildSystemPrompt(req.appContext.register, dictionary);

    const controller = linkAbort(signal);
    const iterator = this.streamFactory({
      system,
      transcript: req.transcript,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const assembled: string[] = [];
    let stopReason: string | null = null;

    try {
      let step = await this.firstChunk(iterator);
      while (!step.done) {
        const chunk = step.value;
        if (chunk.type === 'text') {
          assembled.push(chunk.text);
          if (chunk.text.length > 0) yield chunk.text;
        } else {
          stopReason = chunk.stopReason;
        }
        if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
        step = await iterator.next();
      }
    } catch (err) {
      controller.abort();
      if (err instanceof FormatTimeoutError) throw err;
      // Caller-initiated abort propagates untouched — it is not a provider failure.
      if (isAbortError(err) || signal.aborted) throw err;
      throw new FormatUnavailableError('formatting provider error', { cause: err });
    }

    // stop_reason "refusal" is a provider outcome that maps to FORMAT_UNAVAILABLE (§8).
    if (stopReason === 'refusal') {
      throw new FormatUnavailableError('model refused to format the utterance');
    }

    const text = assembled.join('');
    // commandsApplied is telemetry for the deterministic grammar (MockFormatter). The model
    // path cannot attribute which commands fired, so it reports none.
    return { text, wordCount: countWords(text), commandsApplied: [] };
  }
}

function abortError(): Error {
  const err = new Error('format aborted');
  err.name = 'AbortError';
  return err;
}
