// Phase 3 gate E2E — the whole backend, keyless under MOCK_MODE=1, driven through the REAL
// composition root (`buildComposition` + `buildServer`). Proves the three integration seams this
// gate wired:
//   1. REST flow  — /v1/session/token → /v1/me (§5 shape, pro plan, usage) · dictionary POST/GET ·
//                   history starts empty.
//   2. WS flow    — a full utterance (frames → audio.end → format.done) THEN `usage.update` with
//                   incremented words, the formatted transcript now readable via GET /v1/history,
//                   and the dictionary entry observed inside the FormatRequest (spy formatter).
//   3. Quota path — a tiny injected weekly limit → the exceeding utterance STILL delivers
//                   format.done AND is followed by the §8 QUOTA_EXCEEDED error + the overage
//                   usage.update ("never eat the user's words").
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  MockFormatter,
  encodeAudioFrame,
  type AppContext,
  type ClientMessage,
  type DictionaryEntry,
  type FormatRequest,
  type FormatResult,
  type Formatter,
  type ServerMessage,
} from '@undertone/shared';
import { buildComposition, buildServer, type Composition } from './index';
import { loadEnv } from './env';
import type { GatewayDeps } from './ws';
import type { MeterHook } from './ws';
import { FakeUsageRepo, InMemoryRedis, UsageCounter, weekStartMondayUtc } from './usage';

const APP_CONTEXT: AppContext = {
  bundleId: 'slack.exe',
  appName: 'Slack',
  windowTitle: 'general',
  register: 'chat',
};

/** A formatter that records the dictionary it was handed, then delegates to the real MockFormatter. */
class SpyFormatter implements Formatter {
  lastDictionary: DictionaryEntry[] | undefined;
  private readonly inner = new MockFormatter();

  async *format(req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    this.lastDictionary = req.dictionary;
    return yield* this.inner.format(req, signal);
  }
}

interface Booted {
  wsUrl: string;
  httpBase: string;
  composition: Composition;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** Boot the full mock-mode composition, optionally overriding the gateway (spy formatter / meter). */
async function boot(overrides?: Partial<GatewayDeps>): Promise<Booted> {
  const env = loadEnv({ MOCK_MODE: '1' });
  const composition = await buildComposition(env);
  const gateway: GatewayDeps = { ...composition.gateway, ...overrides };
  const app = buildServer(env, gateway, composition.appDeps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  closers.push(async () => {
    await app.close();
    await composition.close();
  });
  return {
    wsUrl: `ws://127.0.0.1:${port}/v1/stream`,
    httpBase: `http://127.0.0.1:${port}`,
    composition,
  };
}

async function fetchToken(httpBase: string): Promise<string> {
  const res = await fetch(`${httpBase}/v1/session/token`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string; expiresAt: string };
  return body.token;
}

function audioFrame(utteranceId: number, seq: number): Uint8Array {
  const payload = new Uint8Array(640).fill(seq % 256);
  return encodeAudioFrame(utteranceId, seq, payload);
}

class E2EClient {
  private readonly ws: WebSocket;
  readonly received: ServerMessage[] = [];
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
    this.opened = new Promise<void>((resolve) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', () => resolve());
    });
  }

  waitOpen(): Promise<void> {
    return this.opened;
  }
  sendJSON(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }
  sendFrame(frame: Uint8Array): void {
    this.ws.send(frame, { binary: true });
  }
  waitFor(match: (m: ServerMessage) => boolean, timeoutMs = 4000): Promise<ServerMessage> {
    const existing = this.received.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      this.waiters.push({ match, resolve, timer });
    });
  }
  waitType<T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> {
    return this.waitFor((m) => m.t === t) as Promise<Extract<ServerMessage, { t: T }>>;
  }
  close(): void {
    this.ws.close();
  }
}

/** Drive one complete utterance over an already-open connection; resolve once `format.done` lands. */
async function runUtterance(client: E2EClient, utteranceId: number): Promise<void> {
  client.sendJSON({ t: 'utterance.start', utteranceId, appContext: APP_CONTEXT });
  for (let seq = 0; seq < 25; seq++) client.sendFrame(audioFrame(utteranceId, seq));
  await client.waitType('transcript.partial');
  client.sendJSON({ t: 'audio.end', utteranceId, lastFrameSeq: 24 });
  await client.waitFor((m) => m.t === 'format.done' && m.utteranceId === utteranceId);
}

describe('Phase 3 gate — full backend E2E (composition root, keyless MOCK_MODE)', () => {
  it('REST: session/token → me (pro plan + usage) · dictionary POST/GET · history empty', async () => {
    const { httpBase } = await boot();
    await fetchToken(httpBase); // proves the token route is live under the composed authenticator

    const meRes = await fetch(`${httpBase}/v1/me`);
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as {
      userId: string;
      email: string;
      plan: string;
      usage: { wordsThisWeek: number; limit: number };
    };
    expect(me.userId).toBe('user_mock');
    expect(me.plan).toBe('pro'); // seeded stored-pro + active sub → effective pro (§5)
    expect(me.usage).toEqual({ wordsThisWeek: 0, limit: 50000 });

    // Dictionary POST then GET — the created entry is visible in the list (§5).
    const postRes = await fetch(`${httpBase}/v1/dictionary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrase: 'Kubernetes', soundsLike: ['cooper netties'] }),
    });
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as DictionaryEntry;
    expect(created.phrase).toBe('Kubernetes');

    const listRes = await fetch(`${httpBase}/v1/dictionary`);
    const list = (await listRes.json()) as { entries: DictionaryEntry[] };
    expect(list.entries.map((e) => e.phrase)).toContain('Kubernetes');

    // History starts empty (§5).
    const histRes = await fetch(`${httpBase}/v1/history`);
    const hist = (await histRes.json()) as { items: unknown[] };
    expect(hist.items).toEqual([]);
  });

  it('REST /v1/format: browser transcript → formatted text + usage + history persisted (D-026 wiring)', async () => {
    const { httpBase } = await boot();

    const res = await fetch(`${httpBase}/v1/format`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: 'hello world period', appContext: APP_CONTEXT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      text: string;
      wordCount: number;
      commandsApplied: string[];
      usage: { wordsThisWeek: number; limit: number } | null;
      exceeded: boolean;
    };
    // The SAME MockFormatter the WS path uses → identical polished output + §4.3 command telemetry.
    expect(body.text).toBe('Hello world.');
    expect(body.wordCount).toBe(2);
    expect(body.commandsApplied).toContain('period');
    expect(body.usage).toEqual({ wordsThisWeek: 2, limit: 50000 });
    expect(body.exceeded).toBe(false);

    // Persisted through the SAME hook instance the gateway got → readable via GET /v1/history (§7).
    const hist = (await (await fetch(`${httpBase}/v1/history`)).json()) as {
      items: Array<{ text: string; wordCount: number }>;
    };
    expect(hist.items.map((i) => i.text)).toContain('Hello world.');

    // /v1/me reflects the metered words (meter hook + reader share the same Redis counter).
    const me = (await (await fetch(`${httpBase}/v1/me`)).json()) as {
      usage: { wordsThisWeek: number };
    };
    expect(me.usage.wordsThisWeek).toBe(2);
  });

  it('WS: utterance → usage.update (incremented) + history persisted + dictionary reached formatter', async () => {
    const spy = new SpyFormatter();
    const { wsUrl, httpBase } = await boot({ formatter: spy });

    // Seed a dictionary entry via REST so the pipeline's loadDictionary hook returns it.
    await fetch(`${httpBase}/v1/dictionary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrase: 'Kubernetes', soundsLike: ['cooper netties'] }),
    });

    const token = await fetchToken(httpBase);
    const client = new E2EClient(`${wsUrl}?token=${token}`);
    await client.waitOpen();

    client.sendJSON({
      t: 'session.start',
      sessionId: 'gate3-ws',
      appContext: APP_CONTEXT,
      locale: 'en-US',
    });
    await client.waitType('session.ready');

    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    for (let seq = 0; seq < 25; seq++) client.sendFrame(audioFrame(1, seq));
    await client.waitType('transcript.partial');
    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 24 });

    const final = await client.waitType('transcript.final');
    expect(final.text).toBe('hello world');

    const done = await client.waitType('format.done');
    expect(done.text).toBe('Hello world.'); // MockFormatter output
    expect(done.wordCount).toBe(2);

    // §4.3: usage.update arrives after format.done with the incremented weekly words + pro cap.
    const usage = await client.waitType('usage.update');
    expect(usage.wordsThisWeek).toBe(2);
    expect(usage.limit).toBe(50000);

    // The dictionary entry reached the FormatRequest the formatter received (§6 loader → filter).
    expect(spy.lastDictionary?.map((e) => e.phrase)).toContain('Kubernetes');

    // The formatted transcript is now persisted + readable via GET /v1/history (§7).
    const histRes = await fetch(`${httpBase}/v1/history`);
    const hist = (await histRes.json()) as { items: Array<{ text: string; wordCount: number }> };
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0]!.text).toBe('Hello world.');
    expect(hist.items[0]!.wordCount).toBe(2);

    // /v1/me now reflects the metered words (meter + reader share the same counter).
    const me = (await (await fetch(`${httpBase}/v1/me`)).json()) as {
      usage: { wordsThisWeek: number };
    };
    expect(me.usage.wordsThisWeek).toBe(2);

    client.close();
  });

  it('Quota: exceeding utterance still returns format.done + QUOTA_EXCEEDED error + overage usage.update (§8)', async () => {
    // Inject a tiny weekly limit so a single 2-word utterance trips the cap deterministically.
    const counter = new UsageCounter(new InMemoryRedis());
    const repo = new FakeUsageRepo();
    const TINY_LIMIT = 1;
    const tinyMeter: MeterHook = async (userId, wordCount, _plan) => {
      const weekStart = weekStartMondayUtc(new Date());
      const total = await counter.increment(userId, weekStart, wordCount);
      await repo.setWeekTotal(userId, weekStart, total);
      return { wordsThisWeek: total, limit: TINY_LIMIT, exceeded: total > TINY_LIMIT };
    };

    const { wsUrl, httpBase } = await boot({ meterUsage: tinyMeter });
    const token = await fetchToken(httpBase);
    const client = new E2EClient(`${wsUrl}?token=${token}`);
    await client.waitOpen();

    client.sendJSON({
      t: 'session.start',
      sessionId: 'gate3-quota',
      appContext: APP_CONTEXT,
      locale: 'en-US',
    });
    await client.waitType('session.ready');

    await runUtterance(client, 1);

    // The user's words are NEVER eaten: format.done with the formatted transcript still arrived.
    const done = client.received.find((m) => m.t === 'format.done');
    expect(done).toBeDefined();
    if (done?.t === 'format.done') expect(done.text).toBe('Hello world.');

    // usage.update reflects the overage (2 words against the tiny cap of 1).
    const usage = await client.waitType('usage.update');
    expect(usage.wordsThisWeek).toBe(2);
    expect(usage.limit).toBe(TINY_LIMIT);

    // §8 QUOTA_EXCEEDED follows the transcript (non-retryable), never precedes format.done.
    const err = await client.waitFor((m) => m.t === 'error' && m.code === 'QUOTA_EXCEEDED');
    if (err.t === 'error') {
      expect(err.code).toBe('QUOTA_EXCEEDED');
      expect(err.retryable).toBe(false);
    }
    const doneIdx = client.received.findIndex((m) => m.t === 'format.done');
    const quotaIdx = client.received.findIndex(
      (m) => m.t === 'error' && m.code === 'QUOTA_EXCEEDED',
    );
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(quotaIdx).toBeGreaterThan(doneIdx);

    client.close();
  });
});
