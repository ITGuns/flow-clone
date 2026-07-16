// Phase 1 gate E2E — the full CONTRACTS pipeline over a real socket, driven by the REAL
// composition-root providers (MockASRProvider + MockFormatter from @undertone/shared, selected by
// buildGatewayDeps under MOCK_MODE=1). No test-local ASR/formatter fakes on the happy path: this
// exercises exactly what `start()` wires in mock mode. A real Fastify server on an ephemeral port,
// a real `ws` client, a JWT minted via POST /v1/session/token, then session.start → utterance.start
// → ≥25 binary audio frames (640B, §4.2 header) → audio.end, asserting the §2 frame sequence and
// the §9 timing marks. A second test covers the §8 FORMAT fallback (a timing-out formatter → error
// frame + raw format.done). Measured mock-mode timings are printed for the orchestrator.
import { afterEach, describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  MockASRProvider,
  encodeAudioFrame,
  type AppContext,
  type ClientMessage,
  type FormatRequest,
  type FormatResult,
  type Formatter,
  type ServerMessage,
} from '@undertone/shared';
import { buildGatewayDeps, buildServer } from './index';
import { loadEnv } from './env';
import type { GatewayDeps } from './ws';

const APP_CONTEXT: AppContext = {
  bundleId: 'slack.exe',
  appName: 'Slack',
  windowTitle: 'general',
  register: 'chat',
};

// A formatter that never produces a first token — forces the §8 TTFT ceiling to trip. It rejects
// on abort (the pipeline aborts on timeout); the `yield` below is unreachable but present so the
// async generator is well-formed.
class HangingFormatter implements Formatter {
  async *format(_req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    await new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(new Error('aborted'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    yield ''; // unreachable — the await always rejects when the TTFT ceiling aborts
    return { text: '', wordCount: 0, commandsApplied: [] };
  }
}

const servers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!();
});

interface Endpoints {
  wsUrl: string;
  httpBase: string;
}

async function startServer(deps: GatewayDeps): Promise<Endpoints> {
  const app = buildServer(loadEnv({ MOCK_MODE: '1' }), deps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  servers.push(() => app.close());
  return { wsUrl: `ws://127.0.0.1:${port}/v1/stream`, httpBase: `http://127.0.0.1:${port}` };
}

/** Fetch a fresh session JWT the way the desktop client does — POST /v1/session/token (§5). */
async function fetchToken(httpBase: string): Promise<string> {
  const res = await fetch(`${httpBase}/v1/session/token`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string; expiresAt: string };
  return body.token;
}

/** One 640-byte PCM16 frame (20ms @16kHz mono) with a correct §4.2 header. */
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

describe('Phase 1 gate — pipeline E2E (real MockASRProvider + MockFormatter)', () => {
  it('token → WS → session.start → frames → audio.end → partial/final/deltas/done + §9 marks', async () => {
    const { wsUrl, httpBase } = await startServer(buildGatewayDeps(loadEnv({ MOCK_MODE: '1' })));
    const token = await fetchToken(httpBase);
    const client = new E2EClient(`${wsUrl}?token=${token}`);
    await client.waitOpen();

    client.sendJSON({
      t: 'session.start',
      sessionId: 'e2e-happy',
      appContext: APP_CONTEXT,
      locale: 'en-US',
    });
    await client.waitType('session.ready');

    client.sendJSON({ t: 'utterance.start', utteranceId: 1, appContext: APP_CONTEXT });
    for (let seq = 0; seq < 25; seq++) client.sendFrame(audioFrame(1, seq));

    // ≥1 cumulative partial must arrive during speech, before we finalize (§4.3).
    const partial = await client.waitType('transcript.partial');
    expect(partial.text.length).toBeGreaterThan(0);

    client.sendJSON({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 24 });

    const final = await client.waitType('transcript.final');
    expect(final.text).toBe('hello world');
    expect(final.asrMs).toBeGreaterThanOrEqual(0);

    const delta = await client.waitType('format.delta');
    expect(delta.text.length).toBeGreaterThan(0);

    const done = await client.waitType('format.done');
    expect(done.text).toBe('Hello world.'); // MockFormatter capitalizes + terminal period
    expect(done.wordCount).toBe(2);

    // §9 server marks: present, non-negative, monotonic non-decreasing.
    const t = done.timings;
    expect(t.t_asr_final).toBeGreaterThanOrEqual(0);
    expect(t.t_prompt_built).toBeGreaterThanOrEqual(t.t_asr_final!);
    expect(t.t_format_ttft).toBeGreaterThanOrEqual(t.t_prompt_built!);
    expect(t.t_format_done).toBeGreaterThanOrEqual(t.t_format_ttft!);

    // audio.ack received — one fires every 25 frames (§4.3), i.e. at frameSeq 24.
    expect(client.received.some((m) => m.t === 'audio.ack' && m.frameSeq === 24)).toBe(true);

    // usage.update is a Phase 3 concern (metering); the pipeline must NOT depend on it here.
    expect(client.received.some((m) => m.t === 'usage.update')).toBe(false);

    // Print the measured mock-mode timings for the orchestrator (ms since t_keyup).
    console.info(`[gate1-e2e] mock-mode timings (ms since t_keyup): ${JSON.stringify(t)}`);

    client.close();
  });

  it('FORMAT fallback: a timing-out formatter → error frame + raw format.done (§8)', async () => {
    const deps: GatewayDeps = {
      asrProvider: new MockASRProvider(), // real fixture-driven ASR
      formatter: new HangingFormatter(),
      ttftTimeoutMs: 60, // trip the TTFT ceiling fast
    };
    const { wsUrl, httpBase } = await startServer(deps);
    const token = await fetchToken(httpBase);
    const client = new E2EClient(`${wsUrl}?token=${token}`);
    await client.waitOpen();

    client.sendJSON({
      t: 'session.start',
      sessionId: 'e2e-fallback',
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

    const err = await client.waitType('error');
    expect(err.code).toBe('FORMAT_TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBeGreaterThan(0);

    // §8 raw-injection fallback: the user's words are still delivered, unformatted.
    const done = await client.waitType('format.done');
    expect(done.text).toBe('hello world'); // RAW transcript, not "Hello world."
    expect(done.wordCount).toBe(2);

    console.info(
      `[gate1-e2e] format-fallback timings (ms since t_keyup): ${JSON.stringify(done.timings)}`,
    );

    client.close();
  });
});
