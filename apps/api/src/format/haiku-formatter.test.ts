import { describe, it, expect } from 'vitest';
import type { AppContext, DictionaryEntry, FormatRequest, Register } from '@undertone/shared';
import {
  FormatTimeoutError,
  FormatUnavailableError,
  HaikuFormatter,
  type HaikuChunk,
  type HaikuStreamFactory,
  type HaikuStreamInput,
} from './haiku-formatter';

function appContext(register: Register = 'chat'): AppContext {
  return { bundleId: 'slack.exe', appName: 'Slack', windowTitle: '', register };
}

function req(transcript: string, overrides: Partial<FormatRequest> = {}): FormatRequest {
  return {
    transcript,
    appContext: appContext(overrides.appContext?.register),
    dictionary: overrides.dictionary ?? [],
    locale: 'en-US',
  };
}

function entry(phrase: string, soundsLike: string[] = []): DictionaryEntry {
  return { id: `id-${phrase}`, phrase, soundsLike, createdAt: '2026-07-14T00:00:00.000Z' };
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

/** A cooperative fake stream: yields the given text deltas, then a terminal done. */
function fakeStream(
  deltas: string[],
  stopReason: string | null = 'end_turn',
  hooks: { capture?: (input: HaikuStreamInput) => void; delayFirstMs?: number } = {},
): HaikuStreamFactory {
  return function factory(input: HaikuStreamInput): AsyncIterable<HaikuChunk> {
    hooks.capture?.(input);
    return (async function* gen(): AsyncGenerator<HaikuChunk> {
      if (hooks.delayFirstMs) await new Promise((r) => setTimeout(r, hooks.delayFirstMs));
      for (const text of deltas) {
        if (input.signal.aborted) throw abortError();
        yield { type: 'text', text };
      }
      yield { type: 'done', stopReason };
    })();
  };
}

async function drain(
  gen: AsyncGenerator<string, { text: string; wordCount: number; commandsApplied: string[] }>,
): Promise<{
  chunks: string[];
  result: { text: string; wordCount: number; commandsApplied: string[] };
}> {
  const chunks: string[] = [];
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

describe('HaikuFormatter — streaming assembly', () => {
  it('yields SDK text deltas and returns the assembled FormatResult', async () => {
    const formatter = new HaikuFormatter({ streamFactory: fakeStream(['Hello ', 'world.']) });
    const { chunks, result } = await drain(
      formatter.format(req('hello world period'), new AbortController().signal),
    );
    expect(chunks).toEqual(['Hello ', 'world.']);
    expect(result.text).toBe('Hello world.');
    expect(result.wordCount).toBe(2);
    expect(result.commandsApplied).toEqual([]); // model path cannot attribute commands
  });

  it('builds a system prompt carrying the active register and grammar', async () => {
    let captured: HaikuStreamInput | undefined;
    const formatter = new HaikuFormatter({
      streamFactory: fakeStream(['ok'], 'end_turn', { capture: (i) => (captured = i) }),
    });
    await drain(
      formatter.format(
        req('xylotranscriptmarker', { appContext: appContext('email') }),
        new AbortController().signal,
      ),
    );
    expect(captured?.system).toContain('Active register: email.');
    expect(captured?.system).toContain('"new line"');
    // Never leaks: the transcript rides in the user turn, not the system prompt.
    expect(captured?.system).not.toContain('xylotranscriptmarker');
  });
});

describe('HaikuFormatter — dictionary injection + cap interaction', () => {
  it('filters the dictionary against the transcript before building the prompt', async () => {
    // 201 non-matching filler + 1 matching entry → over the §6 cap → fuzzy filter applies.
    const filler: DictionaryEntry[] = Array.from({ length: 201 }, (_v, i) => entry(`w${i}`));
    const dictionary = [...filler, entry('Kubernetes', ['cooper netties'])];
    let captured: HaikuStreamInput | undefined;
    const formatter = new HaikuFormatter({
      streamFactory: fakeStream(['ok'], 'end_turn', { capture: (i) => (captured = i) }),
    });
    await drain(
      formatter.format(
        req('we deploy kubernetes today', { dictionary }),
        new AbortController().signal,
      ),
    );
    expect(captured?.system).toContain('- Kubernetes (may be misheard as: cooper netties)');
    expect(captured?.system).not.toContain('- w0');
    expect(captured?.system).not.toContain('- w200');
  });
});

describe('HaikuFormatter — abort mid-stream', () => {
  it('propagates an abort raised after the first delta', async () => {
    const controller = new AbortController();
    const gen = new HaikuFormatter({ streamFactory: fakeStream(['a', 'b', 'c']) }).format(
      req('x'),
      controller.signal,
    );
    const first = await gen.next();
    expect(first).toEqual({ value: 'a', done: false });
    controller.abort();
    await expect(gen.next()).rejects.toThrow();
  });
});

describe('HaikuFormatter — TTFT timeout', () => {
  it('throws FormatTimeoutError when no delta arrives within the budget', async () => {
    const formatter = new HaikuFormatter({
      ttftMs: 15,
      streamFactory: fakeStream(['late'], 'end_turn', { delayFirstMs: 200 }),
    });
    const gen = formatter.format(req('x'), new AbortController().signal);
    await expect(gen.next()).rejects.toBeInstanceOf(FormatTimeoutError);
  });
});

describe('HaikuFormatter — provider failures map to FORMAT_UNAVAILABLE', () => {
  it('maps a refusal stop reason to FormatUnavailableError', async () => {
    const formatter = new HaikuFormatter({ streamFactory: fakeStream([], 'refusal') });
    const gen = formatter.format(req('x'), new AbortController().signal);
    await expect(drain(gen)).rejects.toBeInstanceOf(FormatUnavailableError);
  });

  it('maps a connect/5xx stream error to FormatUnavailableError', async () => {
    // A stream that rejects on the first read (models a connect/5xx failure).
    const factory: HaikuStreamFactory = () => ({
      [Symbol.asyncIterator]: (): AsyncIterator<HaikuChunk> => ({
        next: (): Promise<IteratorResult<HaikuChunk>> => Promise.reject(new Error('ECONNREFUSED')),
      }),
    });
    const gen = new HaikuFormatter({ streamFactory: factory }).format(
      req('x'),
      new AbortController().signal,
    );
    await expect(gen.next()).rejects.toBeInstanceOf(FormatUnavailableError);
  });
});

// One real-API smoke test — runs only when a key is present (never in MOCK_MODE CI).
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('HaikuFormatter — real API', () => {
  it('formats a short utterance end-to-end', async () => {
    const formatter = new HaikuFormatter();
    const { chunks, result } = await drain(
      formatter.format(req('hello world new line this is a test'), new AbortController().signal),
    );
    expect(result.text.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBe(result.text);
    expect(result.wordCount).toBeGreaterThan(0);
  }, 30000);
});
