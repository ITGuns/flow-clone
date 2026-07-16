import { describe, it, expect } from 'vitest';
import { DictationClient, type DictationEvents } from './dictation-client';
import { FakeSocket, FakeSocketFactory } from './fake-socket';
import { buildAppContext } from '../register';

const WS_URL = 'ws://localhost:8080/v1/stream';

interface Harness {
  client: DictationClient;
  factory: FakeSocketFactory;
  tokens: string[];
  recorded: {
    status: string[];
    partials: [number, string][];
    finals: [number, string, number][];
    deltas: [number, string][];
    dones: { utteranceId: number; text: string; wordCount: number; unformatted: boolean }[];
    usage: [number, number][];
    quota: number[];
    errors: { code: string; message: string }[];
  };
}

function makeHarness(): Harness {
  const factory = new FakeSocketFactory();
  const tokens: string[] = [];
  let n = 0;
  const recorded: Harness['recorded'] = {
    status: [],
    partials: [],
    finals: [],
    deltas: [],
    dones: [],
    usage: [],
    quota: [],
    errors: [],
  };
  const events: DictationEvents = {
    onStatus: (s) => recorded.status.push(s),
    onPartial: (u, t) => recorded.partials.push([u, t]),
    onFinal: (u, t, ms) => recorded.finals.push([u, t, ms]),
    onFormatDelta: (u, t) => recorded.deltas.push([u, t]),
    onFormatDone: (r) => recorded.dones.push(r),
    onUsage: (w, l) => recorded.usage.push([w, l]),
    onQuotaExceeded: (u) => recorded.quota.push(u),
    onError: (e) => recorded.errors.push({ code: e.code, message: e.message }),
  };
  const client = new DictationClient({
    wsUrl: WS_URL,
    tokenProvider: () => {
      n += 1;
      const token = `token-${n}`;
      tokens.push(token);
      return Promise.resolve(token);
    },
    events,
    socketFactory: factory.create,
    sessionIdFactory: () => 'sess-1',
  });
  return { client, factory, tokens, recorded };
}

async function establish(h: Harness): Promise<FakeSocket> {
  const promise = h.client.connect(buildAppContext('document'));
  const socket = await h.factory.waitFor(0);
  socket.emitOpen();
  socket.emitMessage({ t: 'session.ready', sessionId: 'sess-1' });
  await promise;
  return socket;
}

describe('DictationClient — handshake + happy path', () => {
  it('sends session.start with the appContext then resolves on session.ready', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    const starts = socket.controlByType('session.start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.appContext.register).toBe('document');
    expect(starts[0]!.appContext.bundleId).toBe('web.dashboard');
    expect(starts[0]!.locale).toBe('en-US');
    expect(h.client.getStatus()).toBe('ready');
    expect(h.recorded.status).toEqual(['connecting', 'ready']);
  });

  it('streams an utterance: utterance.start (register from style) → frames → audio.end', async () => {
    const h = makeHarness();
    const socket = await establish(h);

    const utteranceId = h.client.beginUtterance(buildAppContext('email'));
    expect(utteranceId).toBe(1);
    h.client.sendAudioFrame(new Uint8Array(640).fill(1));
    h.client.sendAudioFrame(new Uint8Array(640).fill(2));
    h.client.endUtterance();

    const starts = socket.controlByType('utterance.start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.utteranceId).toBe(1);
    expect(starts[0]!.appContext.register).toBe('email'); // style selector drives the register

    const frames = socket.audioFrames();
    expect(frames.map((f) => f.frameSeq)).toEqual([0, 1]);
    expect(frames.every((f) => f.utteranceId === 1)).toBe(true);

    const ends = socket.controlByType('audio.end');
    expect(ends[0]).toEqual({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 1 });
  });

  it('relays partial → final → delta → done → usage to the UI callbacks', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    h.client.beginUtterance(buildAppContext('document'));

    socket.emitMessage({ t: 'transcript.partial', utteranceId: 1, text: 'hello wor' });
    socket.emitMessage({ t: 'transcript.final', utteranceId: 1, text: 'hello world', asrMs: 120 });
    socket.emitMessage({ t: 'format.delta', utteranceId: 1, text: 'Hello ' });
    socket.emitMessage({ t: 'format.delta', utteranceId: 1, text: 'world.' });
    socket.emitMessage({
      t: 'format.done',
      utteranceId: 1,
      text: 'Hello world.',
      wordCount: 2,
      timings: {},
    });
    socket.emitMessage({ t: 'usage.update', wordsThisWeek: 42, limit: 2000 });

    expect(h.recorded.partials).toEqual([[1, 'hello wor']]);
    expect(h.recorded.finals).toEqual([[1, 'hello world', 120]]);
    expect(h.recorded.deltas).toEqual([
      [1, 'Hello '],
      [1, 'world.'],
    ]);
    expect(h.recorded.dones).toEqual([
      { utteranceId: 1, text: 'Hello world.', wordCount: 2, unformatted: false },
    ]);
    expect(h.recorded.usage).toEqual([[42, 2000]]);
  });

  it('audio.end carries lastFrameSeq -1 when no frame was streamed', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    h.client.beginUtterance(buildAppContext('document'));
    h.client.endUtterance();
    expect(socket.controlByType('audio.end')[0]!.lastFrameSeq).toBe(-1);
  });
});

describe('DictationClient — §8 error mapping', () => {
  it('FORMAT_UNAVAILABLE marks the following format.done as unformatted, not an error', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    h.client.beginUtterance(buildAppContext('document'));

    socket.emitMessage({
      t: 'error',
      code: 'FORMAT_UNAVAILABLE',
      message: 'formatter down',
      retryable: true,
      retryAfterMs: 1000,
      utteranceId: 1,
    });
    socket.emitMessage({
      t: 'format.done',
      utteranceId: 1,
      text: 'raw transcript',
      wordCount: 2,
      timings: {},
    });

    expect(h.recorded.errors).toEqual([]); // never surfaced as a blocking error
    expect(h.recorded.dones[0]).toEqual({
      utteranceId: 1,
      text: 'raw transcript',
      wordCount: 2,
      unformatted: true,
    });
  });

  it('QUOTA_EXCEEDED fires an upgrade hint but does not block the delivered result', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    h.client.beginUtterance(buildAppContext('document'));

    socket.emitMessage({
      t: 'format.done',
      utteranceId: 1,
      text: 'Formatted.',
      wordCount: 1,
      timings: {},
    });
    socket.emitMessage({ t: 'usage.update', wordsThisWeek: 2001, limit: 2000 });
    socket.emitMessage({
      t: 'error',
      code: 'QUOTA_EXCEEDED',
      message: 'weekly cap',
      retryable: false,
      utteranceId: 1,
    });

    expect(h.recorded.dones[0]!.text).toBe('Formatted.');
    expect(h.recorded.quota).toEqual([1]);
    expect(h.recorded.errors).toEqual([]);
  });

  it('a generic pipeline error (ASR_UNAVAILABLE) is surfaced to onError', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    socket.emitMessage({
      t: 'error',
      code: 'ASR_UNAVAILABLE',
      message: 'asr down',
      retryable: true,
      retryAfterMs: 1000,
      utteranceId: 1,
    });
    expect(h.recorded.errors).toEqual([{ code: 'ASR_UNAVAILABLE', message: 'asr down' }]);
  });

  it('ignores non-text socket data (server control is always JSON text)', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    socket.emitRaw(new ArrayBuffer(8));
    expect(h.recorded.errors).toEqual([]);
    expect(h.recorded.dones).toEqual([]);
  });
});

describe('DictationClient — reconnect with a fresh token', () => {
  it('re-opens a new session with a freshly fetched token on unexpected close', async () => {
    const h = makeHarness();
    const first = await establish(h);
    expect(first.url).toContain('token-1');

    // Unexpected drop.
    first.emitClose(1006);
    const second = await h.factory.waitFor(1);
    expect(second.url).toContain('token-2'); // fetched a fresh token (§4.1)

    second.emitOpen();
    // session.start is re-sent on the new socket.
    expect(second.controlByType('session.start')).toHaveLength(1);
    expect(h.recorded.status).toContain('reconnecting');
  });

  it('does not reconnect after an intentional close', async () => {
    const h = makeHarness();
    const socket = await establish(h);
    h.client.close();
    expect(socket.closedWith).toBe(1000);
    // No second socket is ever created.
    const created = h.factory.sockets.length;
    socket.emitClose(1000);
    expect(h.factory.sockets.length).toBe(created);
    expect(h.client.getStatus()).toBe('closed');
  });

  it('surfaces OFFLINE_BUFFERED once reconnect attempts are exhausted', async () => {
    const h = makeHarness();
    const first = await establish(h);
    first.emitClose(1006); // uses the single reconnect budget
    const second = await h.factory.waitFor(1);
    second.emitClose(1006); // no budget left
    expect(h.recorded.errors.some((e) => e.code === 'OFFLINE_BUFFERED')).toBe(true);
    expect(h.client.getStatus()).toBe('closed');
  });
});

describe('DictationClient — token fetch failure', () => {
  it('rejects connect() and goes closed when the token cannot be obtained', async () => {
    const factory = new FakeSocketFactory();
    const client = new DictationClient({
      wsUrl: WS_URL,
      tokenProvider: () => Promise.reject(new Error('no token')),
      socketFactory: factory.create,
      events: {},
    });
    await expect(client.connect(buildAppContext('document'))).rejects.toThrow('no token');
    expect(client.getStatus()).toBe('closed');
  });
});
