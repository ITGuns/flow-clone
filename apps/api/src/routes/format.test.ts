import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  UndertoneError,
  type AppContext,
  type DictionaryEntry,
  type FormatRequest,
  type FormatResult,
  type Formatter,
} from '@undertone/shared';
import type { MeterHookResult, PersistHookInput } from '../ws';
import type { Authenticator, AuthedUser } from './session-token';
import { registerFormatRoute, type FormatResponse, type FormatRouteDeps } from './format';

const APP_CONTEXT: AppContext = {
  bundleId: 'web.dashboard',
  appName: 'Undertone Web',
  windowTitle: '',
  register: 'document',
};

/** Authenticator that always resolves to a fixed principal. */
function stubAuth(user: AuthedUser = { userId: 'user_mock', plan: 'pro' }): Authenticator {
  return { authenticate: () => Promise.resolve(user) };
}

const rejectingAuth: Authenticator = {
  authenticate: () => Promise.reject(new UndertoneError('AUTH_INVALID')),
};

/** A Formatter whose behaviour is scripted per test; records every FormatRequest it receives. */
class ScriptedFormatter implements Formatter {
  readonly requests: FormatRequest[] = [];
  constructor(
    private readonly script:
      | { kind: 'ok'; deltas: string[]; result: FormatResult }
      | { kind: 'throw' }
      | { kind: 'slow'; delayMs: number },
  ) {}

  async *format(req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    this.requests.push(req);
    if (this.script.kind === 'throw') throw new Error('formatter down');
    if (this.script.kind === 'slow') {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.script.kind === 'slow' ? this.script.delayMs : 0),
      );
    }
    if (this.script.kind === 'ok') {
      for (const delta of this.script.deltas) {
        if (signal.aborted) break;
        yield delta;
      }
      return this.script.result;
    }
    return { text: 'late', wordCount: 1, commandsApplied: [] };
  }
}

/** Records persist calls. */
class RecordingPersist {
  readonly inputs: PersistHookInput[] = [];
  readonly hook = (input: PersistHookInput): Promise<unknown> => {
    this.inputs.push(input);
    return Promise.resolve({ id: 'h1' });
  };
}

/** Records meter calls and returns a scripted result. */
class RecordingMeter {
  readonly calls: { userId: string; wordCount: number; plan: string }[] = [];
  constructor(private readonly result: MeterHookResult) {}
  readonly hook = (userId: string, wordCount: number, plan: string): Promise<MeterHookResult> => {
    this.calls.push({ userId, wordCount, plan });
    return Promise.resolve(this.result);
  };
}

async function makeApp(
  deps: Partial<FormatRouteDeps> & { formatter: Formatter },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerFormatRoute(app, {
    authenticator: deps.authenticator ?? stubAuth(),
    formatter: deps.formatter,
    ...(deps.loadDictionary ? { loadDictionary: deps.loadDictionary } : {}),
    ...(deps.persist ? { persist: deps.persist } : {}),
    ...(deps.meter ? { meter: deps.meter } : {}),
    ...(deps.ttftTimeoutMs !== undefined ? { ttftTimeoutMs: deps.ttftTimeoutMs } : {}),
  });
  await app.ready();
  return app;
}

function post(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/v1/format',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

describe('POST /v1/format', () => {
  it('formats via the injected formatter, persists, meters, and returns usage', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: ['Hello ', 'world.'],
      result: { text: 'Hello world.', wordCount: 2, commandsApplied: ['period'] },
    });
    const persist = new RecordingPersist();
    const meter = new RecordingMeter({ wordsThisWeek: 122, limit: 50000, exceeded: false });
    const app = await makeApp({ formatter, persist: persist.hook, meter: meter.hook });

    const res = await post(app, { transcript: 'hello world period', appContext: APP_CONTEXT });
    expect(res.statusCode).toBe(200);
    const body = res.json<FormatResponse>();
    expect(body).toEqual({
      text: 'Hello world.',
      wordCount: 2,
      commandsApplied: ['period'],
      usage: { wordsThisWeek: 122, limit: 50000 },
      exceeded: false,
    });
    // Persisted with the finalized text + §7 columns (no audio).
    expect(persist.inputs).toEqual([
      {
        userId: 'user_mock',
        text: 'Hello world.',
        appName: 'Undertone Web',
        register: 'document',
        wordCount: 2,
      },
    ]);
    // Metered the finalized word count against the principal's plan.
    expect(meter.calls).toEqual([{ userId: 'user_mock', wordCount: 2, plan: 'pro' }]);
    await app.close();
  });

  it('loads + §6-filters the dictionary into the FormatRequest', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: ['Kubernetes.'],
      result: { text: 'Kubernetes.', wordCount: 1, commandsApplied: [] },
    });
    const entries: DictionaryEntry[] = [
      {
        id: 'd1',
        phrase: 'Kubernetes',
        soundsLike: ['cooper netties'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const app = await makeApp({ formatter, loadDictionary: () => Promise.resolve(entries) });
    await post(app, { transcript: 'kubernetes', appContext: APP_CONTEXT });
    expect(formatter.requests).toHaveLength(1);
    expect(formatter.requests[0]!.dictionary).toEqual(entries);
    expect(formatter.requests[0]!.locale).toBe('en-US');
    await app.close();
  });

  it('keeps the text but flags exceeded:true when the weekly cap is passed (§8)', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: ['Over the line.'],
      result: { text: 'Over the line.', wordCount: 3, commandsApplied: [] },
    });
    const meter = new RecordingMeter({ wordsThisWeek: 50003, limit: 50000, exceeded: true });
    const app = await makeApp({ formatter, meter: meter.hook });
    const res = await post(app, { transcript: 'over the line', appContext: APP_CONTEXT });
    const body = res.json<FormatResponse>();
    expect(body.text).toBe('Over the line.');
    expect(body.exceeded).toBe(true);
    expect(body.usage).toEqual({ wordsThisWeek: 50003, limit: 50000 });
    await app.close();
  });

  it('returns the RAW transcript + unformatted:true when the formatter throws (§8, never eat words)', async () => {
    const formatter = new ScriptedFormatter({ kind: 'throw' });
    const persist = new RecordingPersist();
    const meter = new RecordingMeter({ wordsThisWeek: 3, limit: 2000, exceeded: false });
    const app = await makeApp({ formatter, persist: persist.hook, meter: meter.hook });
    const res = await post(app, { transcript: 'raw words here', appContext: APP_CONTEXT });
    expect(res.statusCode).toBe(200);
    const body = res.json<FormatResponse>();
    expect(body.text).toBe('raw words here');
    expect(body.unformatted).toBe(true);
    expect(body.wordCount).toBe(3);
    expect(body.commandsApplied).toEqual([]);
    // Raw words were delivered → still persisted + metered.
    expect(persist.inputs[0]!.text).toBe('raw words here');
    expect(meter.calls[0]!.wordCount).toBe(3);
    await app.close();
  });

  it('returns the RAW transcript + unformatted:true when the formatter exceeds the TTFT ceiling', async () => {
    const formatter = new ScriptedFormatter({ kind: 'slow', delayMs: 60 });
    const app = await makeApp({ formatter, ttftTimeoutMs: 10 });
    const res = await post(app, { transcript: 'slow words', appContext: APP_CONTEXT });
    expect(res.statusCode).toBe(200);
    const body = res.json<FormatResponse>();
    expect(body.text).toBe('slow words');
    expect(body.unformatted).toBe(true);
    await app.close();
  });

  it('short-circuits an empty transcript with no persist/meter', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: ['x'],
      result: { text: 'x', wordCount: 1, commandsApplied: [] },
    });
    const persist = new RecordingPersist();
    const meter = new RecordingMeter({ wordsThisWeek: 0, limit: 2000, exceeded: false });
    const app = await makeApp({ formatter, persist: persist.hook, meter: meter.hook });
    const res = await post(app, { transcript: '   ', appContext: APP_CONTEXT });
    expect(res.statusCode).toBe(200);
    const body = res.json<FormatResponse>();
    expect(body).toEqual({
      text: '',
      wordCount: 0,
      commandsApplied: [],
      usage: null,
      exceeded: false,
    });
    expect(formatter.requests).toHaveLength(0); // formatter never invoked
    expect(persist.inputs).toHaveLength(0);
    expect(meter.calls).toHaveLength(0);
    await app.close();
  });

  it('returns 401 with an AUTH_INVALID error frame when authentication fails', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: [],
      result: { text: '', wordCount: 0, commandsApplied: [] },
    });
    const app = await makeApp({ formatter, authenticator: rejectingAuth });
    const res = await post(app, { transcript: 'hi', appContext: APP_CONTEXT });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('AUTH_INVALID');
    await app.close();
  });

  it('rejects a malformed body with 400 (bad shape, bad transcript, over-length, bad appContext)', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: [],
      result: { text: '', wordCount: 0, commandsApplied: [] },
    });
    const app = await makeApp({ formatter });

    const notObject = await post(app, 'nope');
    expect(notObject.statusCode).toBe(400);

    const noTranscript = await post(app, { appContext: APP_CONTEXT });
    expect(noTranscript.statusCode).toBe(400);

    const badTranscript = await post(app, { transcript: 42, appContext: APP_CONTEXT });
    expect(badTranscript.statusCode).toBe(400);

    const tooLong = await post(app, { transcript: 'x'.repeat(5001), appContext: APP_CONTEXT });
    expect(tooLong.statusCode).toBe(400);

    const badContext = await post(app, { transcript: 'hi', appContext: { appName: 'X' } });
    expect(badContext.statusCode).toBe(400);

    const badRegister = await post(app, {
      transcript: 'hi',
      appContext: { ...APP_CONTEXT, register: 'nonsense' },
    });
    expect(badRegister.statusCode).toBe(400);

    expect(formatter.requests).toHaveLength(0); // never reached the formatter
    await app.close();
  });

  it('accepts a 5000-char transcript (boundary) and degrades gracefully without hooks', async () => {
    const formatter = new ScriptedFormatter({
      kind: 'ok',
      deltas: ['ok'],
      result: { text: 'ok', wordCount: 1, commandsApplied: [] },
    });
    const app = await makeApp({ formatter }); // no loadDictionary/persist/meter wired
    const res = await post(app, { transcript: 'a'.repeat(5000), appContext: APP_CONTEXT });
    expect(res.statusCode).toBe(200);
    const body = res.json<FormatResponse>();
    expect(body.text).toBe('ok');
    expect(body.usage).toBeNull(); // no meter hook → usage null, exceeded false
    expect(body.exceeded).toBe(false);
    expect(formatter.requests[0]!.dictionary).toEqual([]); // no loader → empty dictionary
    await app.close();
  });
});
