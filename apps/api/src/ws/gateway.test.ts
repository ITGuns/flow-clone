// End-to-end WS gateway tests — real Fastify instance on an ephemeral port, `ws` test clients,
// injected ASR/Formatter fakes (fakes live only here, per task constraints). Covers every
// MUST-COVER scenario from the Phase 1c brief.
import { afterEach, describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  AsrError,
  AsrStreamClosedError,
  AsrTimeoutError,
  encodeAudioFrame,
  type ASRProvider,
  type ASRStream,
  type ASRStreamOptions,
  type AppContext,
  type ClientMessage,
  type FormatRequest,
  type FormatResult,
  type Formatter,
  type ServerMessage,
} from '@undertone/shared';
import { buildServer } from '../index';
import { loadEnv } from '../env';
import { signSessionToken } from './jwt';
import { SessionStore } from './session-store';
import { countWords } from './pipeline';
import type { GatewayDeps } from './gateway';
import type { RateLimiter, RateLimitDecision } from './rate-limiter';

// ── Fakes ─────────────────────────────────────────────────────────────────────────────────────
interface FakeStreamOpts {
  finalText?: string;
  finalizeError?: Error;
  partialAfterFirstFrame?: string;
}

class FakeASRStream implements ASRStream {
  readonly sent: Uint8Array[] = [];
  closed = false;
  private partialCb: ((t: string) => void) | undefined;
  private errorCb: ((e: AsrError) => void) | undefined;
  private emittedPartial = false;
  constructor(private readonly opts: FakeStreamOpts) {}
  sendAudio(chunk: Uint8Array): void {
    if (this.closed) throw new AsrStreamClosedError();
    this.sent.push(chunk);
    if (!this.emittedPartial && this.opts.partialAfterFirstFrame !== undefined) {
      this.emittedPartial = true;
      this.partialCb?.(this.opts.partialAfterFirstFrame);
    }
  }
  finalize(): Promise<string> {
    if (this.opts.finalizeError) return Promise.reject(this.opts.finalizeError);
    return Promise.resolve(this.opts.finalText ?? 'hello world');
  }
  onPartial(cb: (t: string) => void): void {
    this.partialCb = cb;
  }
  onError(cb: (e: AsrError) => void): void {
    this.errorCb = cb;
  }
  close(): void {
    this.closed = true;
  }
  emitError(): void {
    this.errorCb?.(new AsrError('boom'));
  }
}

class FakeASRProvider implements ASRProvider {
  readonly streams: FakeASRStream[] = [];
  constructor(private readonly opts: FakeStreamOpts = {}) {}
  startStream(_opts: ASRStreamOptions): Promise<ASRStream> {
    const s = new FakeASRStream(this.opts);
    this.streams.push(s);
    return Promise.resolve(s);
  }
}

interface FakeFormatterOpts {
  deltas?: string[];
  throwBeforeFirst?: boolean;
  delayFirstMs?: number;
}

class FakeFormatter implements Formatter {
  constructor(private readonly opts: FakeFormatterOpts = {}) {}
  async *format(_req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    if (this.opts.throwBeforeFirst) throw new Error('formatter unavailable');
    if (this.opts.delayFirstMs !== undefined) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.opts.delayFirstMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
    }
    const deltas = this.opts.deltas ?? ['Hello ', 'world.'];
    for (const d of deltas) yield d;
    const text = deltas.join('');
    return { text, wordCount: countWords(text), commandsApplied: [] };
  }
}

// ── Harness ────────────────────────────────────────────────────────────────────────────────────
const APP_CONTEXT: AppContext = {
  bundleId: 'slack.exe',
  appName: 'Slack',
  windowTitle: 'general',
  register: 'chat',
};

const servers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!();
});

async function startServer(deps: GatewayDeps): Promise<string> {
  const app = buildServer(loadEnv({ MOCK_MODE: '1' }), deps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  servers.push(() => app.close());
  return `ws://127.0.0.1:${port}/v1/stream`;
}

async function validToken(sub = 'user_mock'): Promise<string> {
  const { token } = await signSessionToken({ sub, plan: 'pro', jti: `j-${Math.random()}` });
  return token;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class TestClient {
  private readonly ws: WebSocket;
  readonly received: ServerMessage[] = [];
  closeCode: number | undefined;
  private readonly waiters: Array<{
    match: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private readonly opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
      this.received.push(msg);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i]!;
        if (w.match(msg)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(msg);
        }
      }
    });
    this.ws.on('close', (code: number) => {
      this.closeCode = code;
    });
    this.opened = new Promise<void>((resolve) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', () => resolve()); // auth-reject paths error/close instead of opening
    });
  }

  waitOpen(): Promise<void> {
    return this.opened;
  }
  sendJSON(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }
  sendRaw(data: string): void {
    this.ws.send(data);
  }
  sendFrame(frame: Uint8Array): void {
    this.ws.send(frame, { binary: true });
  }
  waitFor(match: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const existing = this.received.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      this.waiters.push({ match, resolve, timer });
    });
  }
  waitType(t: ServerMessage['t']): Promise<ServerMessage> {
    return this.waitFor((m) => m.t === t);
  }
  waitClose(timeoutMs = 3000): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      this.ws.on('close', (code: number) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }
  close(): void {
    this.ws.close();
  }
}

function frame(utteranceId: number, seq: number): Uint8Array {
  return encodeAudioFrame(utteranceId, seq, new Uint8Array(8).fill(seq % 256));
}

async function startSession(client: TestClient, sessionId: string): Promise<void> {
  await client.waitOpen();
  client.sendJSON({ t: 'session.start', sessionId, appContext: APP_CONTEXT, locale: 'en-US' });
  await client.waitType('session.ready');
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────
describe('WS handshake / auth (§4.1)', () => {
  it('closes 4401 on a bad token', async () => {
    const url = await startServer({
      asrProvider: new FakeASRProvider(),
      formatter: new FakeFormatter(),
    });
    const client = new TestClient(`${url}?token=garbage`);
    expect(await client.waitClose()).toBe(4401);
  });

  it('closes 4401 on an expired token', async () => {
    const url = await startServer({
      asrProvider: new FakeASRProvider(),
      formatter: new FakeFormatter(),
    });
    const { token } = await signSessionToken(
      { sub: 'user_mock', plan: 'pro', jti: 'j1' },
      Date.now() - 120_000,
    );
    const client = new TestClient(`${url}?token=${token}`);
    expect(await client.waitClose()).toBe(4401);
  });
});

describe('happy path end-to-end (§2, §9)', () => {
  it('start→frames→acks→audio.end→partial/final→deltas→done with timings', async () => {
    const asr = new FakeASRProvider({ finalText: 'hello world', partialAfterFirstFrame: 'hello' });
    const url = await startServer({
      asrProvider: asr,
      formatter: new FakeFormatter({ deltas: ['Hello ', 'world.'] }),
    });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-happy');

    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    for (let seq = 0; seq <= 29; seq++) client.sendFrame(frame(1, seq));

    // Ack fires every 25 frames → an ack at frameSeq 24.
    const ack = await client.waitFor((m) => m.t === 'audio.ack' && m.frameSeq === 24);
    expect(ack).toMatchObject({ t: 'audio.ack', utteranceId: 1, frameSeq: 24 });

    // Cumulative partial relayed during speech.
    const partial = await client.waitType('transcript.partial');
    expect(partial).toMatchObject({ t: 'transcript.partial', utteranceId: 1, text: 'hello' });

    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 29 });

    const final = await client.waitType('transcript.final');
    expect(final).toMatchObject({ t: 'transcript.final', utteranceId: 1, text: 'hello world' });
    expect((final as { asrMs: number }).asrMs).toBeGreaterThanOrEqual(0);

    const delta = await client.waitType('format.delta');
    expect(delta).toMatchObject({ t: 'format.delta', utteranceId: 1 });

    const done = (await client.waitType('format.done')) as Extract<
      ServerMessage,
      { t: 'format.done' }
    >;
    expect(done.text).toBe('Hello world.');
    expect(done.wordCount).toBe(2);
    // §9 server marks present and monotonic.
    expect(done.timings.t_asr_final).toBeGreaterThanOrEqual(0);
    expect(done.timings.t_prompt_built).toBeGreaterThanOrEqual(done.timings.t_asr_final!);
    expect(done.timings.t_format_ttft).toBeGreaterThanOrEqual(done.timings.t_prompt_built!);
    expect(done.timings.t_format_done).toBeGreaterThanOrEqual(done.timings.t_format_ttft!);

    // All 30 in-order frames reached the ASR stream.
    expect(asr.streams[0]!.sent.length).toBe(30);
  });
});

describe('frame ordering (§4.4)', () => {
  it('drops out-of-order frames and re-acks the high-water mark', async () => {
    const asr = new FakeASRProvider({ finalText: 'ok' });
    const url = await startServer({ asrProvider: asr, formatter: new FakeFormatter() });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-ooo');

    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    client.sendFrame(frame(1, 0)); // accepted → highWater 0
    client.sendFrame(frame(1, 5)); // gap (expected 1) → dropped + re-ack 0

    const reack = await client.waitFor((m) => m.t === 'audio.ack' && m.frameSeq === 0);
    expect(reack).toMatchObject({ t: 'audio.ack', utteranceId: 1, frameSeq: 0 });

    client.sendFrame(frame(1, 1)); // accepted → highWater 1
    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 1 });
    await client.waitType('format.done');

    // Only the two in-order frames (0, 1) were forwarded; seq 5 was dropped.
    expect(asr.streams[0]!.sent.length).toBe(2);
  });
});

describe('resume (§4.4)', () => {
  it('resumes within 60s and continues in order', async () => {
    const asr = new FakeASRProvider({ finalText: 'resumed transcript' });
    const store = new SessionStore(); // real clock → within window
    const url = await startServer({
      asrProvider: asr,
      formatter: new FakeFormatter(),
      sessionStore: store,
    });

    const c1 = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(c1, 'sess-resume');
    c1.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    for (let seq = 0; seq <= 29; seq++) c1.sendFrame(frame(1, seq));
    await c1.waitFor((m) => m.t === 'audio.ack' && m.frameSeq === 24);
    c1.close(); // transport loss
    await delay(80); // let the server observe the close + markDisconnected

    const c2 = new TestClient(`${url}?token=${await validToken()}`);
    await c2.waitOpen();
    c2.sendJSON({
      t: 'session.resume',
      sessionId: 'sess-resume',
      utteranceId: 1,
      lastAckedFrameSeq: 24,
    });
    await c2.waitType('session.ready');
    // Server's high-water (29) implied by the ack it emits right after ready.
    const resumeAck = await c2.waitFor((m) => m.t === 'audio.ack' && m.frameSeq === 29);
    expect(resumeAck).toMatchObject({ utteranceId: 1, frameSeq: 29 });

    // Client replays 25..29 (dups, dropped) then sends new frames 30..31.
    for (let seq = 25; seq <= 31; seq++) c2.sendFrame(frame(1, seq));
    c2.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 31 });

    const final = await c2.waitType('transcript.final');
    expect(final).toMatchObject({ t: 'transcript.final', text: 'resumed transcript' });
    await c2.waitType('format.done');

    // Second stream (post-resume) received only the two genuinely-new frames.
    expect(asr.streams[1]!.sent.length).toBe(2);
  });

  it('rejects resume after the 60s window with SESSION_INVALID', async () => {
    let fakeNow = Date.now();
    const store = new SessionStore(() => fakeNow);
    const url = await startServer({
      asrProvider: new FakeASRProvider(),
      formatter: new FakeFormatter(),
      sessionStore: store,
    });

    const c1 = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(c1, 'sess-expired');
    c1.close();
    await delay(80);

    fakeNow += 61_000; // push past RESUME_TTL_MS

    const c2 = new TestClient(`${url}?token=${await validToken()}`);
    await c2.waitOpen();
    c2.sendJSON({
      t: 'session.resume',
      sessionId: 'sess-expired',
      utteranceId: 1,
      lastAckedFrameSeq: 0,
    });
    const err = (await c2.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('SESSION_INVALID');
    expect(err.retryable).toBe(false);
  });
});

describe('protocol violations (§4, §8)', () => {
  it('malformed JSON → PROTO_ERROR + close 1002', async () => {
    const url = await startServer({
      asrProvider: new FakeASRProvider(),
      formatter: new FakeFormatter(),
    });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await client.waitOpen();
    client.sendRaw('this is not json {');
    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('PROTO_ERROR');
    expect(await client.waitClose()).toBe(1002);
  });

  it('bad frame version → PROTO_ERROR + close 1002', async () => {
    const url = await startServer({
      asrProvider: new FakeASRProvider(),
      formatter: new FakeFormatter(),
    });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-badframe');
    const bad = new Uint8Array(10);
    bad[0] = 0x02; // unknown protocol version
    bad[1] = 0x01;
    client.sendFrame(bad);
    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('PROTO_ERROR');
    expect(await client.waitClose()).toBe(1002);
  });
});

describe('pipeline failure mapping (§8)', () => {
  it('maps ASR finalize timeout → ASR_TIMEOUT', async () => {
    const asr = new FakeASRProvider({ finalizeError: new AsrTimeoutError() });
    const url = await startServer({ asrProvider: asr, formatter: new FakeFormatter() });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-asrto');
    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    client.sendFrame(frame(1, 0));
    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 0 });
    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('ASR_TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBeGreaterThan(0); // requiresBackoff (v1.1.0)
  });

  it('maps generic ASR failure → ASR_UNAVAILABLE', async () => {
    const asr = new FakeASRProvider({ finalizeError: new AsrError('connect refused') });
    const url = await startServer({ asrProvider: asr, formatter: new FakeFormatter() });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-asrun');
    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    client.sendFrame(frame(1, 0));
    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 0 });
    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('ASR_UNAVAILABLE');
  });

  it('FORMAT_TIMEOUT → error AND format.done with the RAW transcript (§8 fallback)', async () => {
    const asr = new FakeASRProvider({ finalText: 'raw words here' });
    const url = await startServer({
      asrProvider: asr,
      formatter: new FakeFormatter({ delayFirstMs: 1000 }),
      ttftTimeoutMs: 40, // force the TTFT ceiling to trip fast
    });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-fmtto');
    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    client.sendFrame(frame(1, 0));
    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 0 });

    await client.waitType('transcript.final');
    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('FORMAT_TIMEOUT');
    expect(err.retryAfterMs).toBeGreaterThan(0);

    const done = (await client.waitType('format.done')) as Extract<
      ServerMessage,
      { t: 'format.done' }
    >;
    expect(done.text).toBe('raw words here'); // RAW transcript, not formatted
    expect(done.wordCount).toBe(3);
  });

  it('FORMAT_UNAVAILABLE → error AND format.done with the RAW transcript', async () => {
    const asr = new FakeASRProvider({ finalText: 'raw only' });
    const url = await startServer({
      asrProvider: asr,
      formatter: new FakeFormatter({ throwBeforeFirst: true }),
    });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-fmtun');
    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    client.sendFrame(frame(1, 0));
    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 0 });

    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('FORMAT_UNAVAILABLE');
    const done = (await client.waitType('format.done')) as Extract<
      ServerMessage,
      { t: 'format.done' }
    >;
    expect(done.text).toBe('raw only');
  });
});

describe('rate limiting (§8)', () => {
  it('over-limit frame → RATE_LIMITED carrying retryAfterMs', async () => {
    const limiter: RateLimiter = {
      checkMessage: (): RateLimitDecision => ({ ok: true }),
      checkFrame: (): RateLimitDecision => ({ ok: false, retryAfterMs: 1234 }),
    };
    const url = await startServer({
      asrProvider: new FakeASRProvider(),
      formatter: new FakeFormatter(),
      rateLimiter: limiter,
    });
    const client = new TestClient(`${url}?token=${await validToken()}`);
    await startSession(client, 'sess-rate');
    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    client.sendFrame(frame(1, 0));
    const err = (await client.waitType('error')) as Extract<ServerMessage, { t: 'error' }>;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(1234);
  });
});
