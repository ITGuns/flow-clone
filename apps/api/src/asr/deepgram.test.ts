import { describe, it, expect, afterEach } from 'vitest';
import { AsrError, AsrStreamClosedError, AsrTimeoutError } from '@undertone/shared';
import type { ASRStream, ASRStreamOptions } from '@undertone/shared';
import { DeepgramASRProvider } from './deepgram';
import {
  FakeDeepgramServer,
  type FakeDeepgramHooks,
  type FakeDeepgramConnection,
} from './fake-deepgram-server';

const OPTS: ASRStreamOptions = {
  sampleRate: 16000,
  encoding: 'linear16',
  channels: 1,
  locale: 'en-US',
};

const CHUNK = new Uint8Array(640); // 20ms PCM16LE @16kHz mono

async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Track resources so every test tears down its socket + server even on assertion failure.
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function harness(
  hooks: FakeDeepgramHooks,
  configOverrides: Partial<{ finalizeTimeoutMs: number; connectTimeoutMs: number }> = {},
): Promise<{ server: FakeDeepgramServer; stream: ASRStream }> {
  const server = new FakeDeepgramServer(hooks);
  cleanups.push(() => server.close());
  await server.ready();
  const provider = new DeepgramASRProvider({
    apiKey: 'test-key',
    baseUrl: server.baseUrl,
    finalizeTimeoutMs: configOverrides.finalizeTimeoutMs ?? 2000,
    connectTimeoutMs: configOverrides.connectTimeoutMs ?? 2000,
  });
  const stream = await provider.startStream(OPTS);
  cleanups.push(() => {
    stream.close();
  });
  return { server, stream };
}

describe('DeepgramASRProvider connection', () => {
  it('sends contract-mandated query params (linear16/16000/mono, interim, endpointing, keywords)', async () => {
    const { server } = await harness({});
    // startStream already connected; the fake captured the upgrade URL.
    const url = server.lastUpgradeUrl;
    expect(url).toContain('encoding=linear16');
    expect(url).toContain('sample_rate=16000');
    expect(url).toContain('channels=1');
    expect(url).toContain('interim_results=true');
    expect(url).toContain('endpointing=');
  });

  it('forwards keywords from ASRStreamOptions', async () => {
    const server = new FakeDeepgramServer({});
    cleanups.push(() => server.close());
    await server.ready();
    const provider = new DeepgramASRProvider({ apiKey: 'k', baseUrl: server.baseUrl });
    const stream = await provider.startStream({ ...OPTS, keywords: ['Kubernetes', 'Fastify'] });
    cleanups.push(() => {
      stream.close();
    });
    expect(server.lastUpgradeUrl).toContain('keywords=Kubernetes');
    expect(server.lastUpgradeUrl).toContain('keywords=Fastify');
  });

  it('rejects startStream with AsrError when the connection is refused', async () => {
    const provider = new DeepgramASRProvider({
      apiKey: 'k',
      baseUrl: 'ws://127.0.0.1:1', // nothing listens on port 1
      connectTimeoutMs: 2000,
    });
    await expect(provider.startStream(OPTS)).rejects.toBeInstanceOf(AsrError);
  });
});

describe('DeepgramASRProvider streaming', () => {
  it('emits cumulative partials and resolves finalize() with the final transcript', async () => {
    const script = ['he', 'hello', 'hello world'];
    let i = 0;
    const { stream } = await harness({
      onAudio: (conn) => {
        if (i < script.length) conn.sendResults(script[i++]!, { isFinal: false });
      },
      onCloseStream: (conn) => {
        conn.sendResults('hello world', { isFinal: true, speechFinal: true });
        conn.sendMetadata();
      },
    });

    const seen: string[] = [];
    stream.onPartial((t) => seen.push(t));
    for (let k = 0; k < script.length; k += 1) {
      stream.sendAudio(CHUNK);
      await waitFor(() => seen.length >= k + 1);
    }
    expect(seen).toEqual(['he', 'hello', 'hello world']);

    await expect(stream.finalize()).resolves.toBe('hello world');
  });

  it('accumulates finalized segments across an utterance (cumulative across is_final)', async () => {
    // Scripted per-chunk: interim "hel" → final "hello" → interim "wor"; then finalize flushes
    // final "world". The cumulative partial must carry finalized segments plus the live interim.
    const perChunk: Array<(conn: FakeDeepgramConnection) => void> = [
      (conn) => conn.sendResults('hel', { isFinal: false }),
      (conn) => conn.sendResults('hello', { isFinal: true }),
      (conn) => conn.sendResults('wor', { isFinal: false }),
    ];
    let idx = 0;
    const { stream } = await harness({
      onAudio: (conn) => {
        const step = perChunk[idx++];
        step?.(conn);
      },
      onCloseStream: (conn) => {
        conn.sendResults('world', { isFinal: true });
        conn.sendMetadata();
      },
    });

    const seen: string[] = [];
    stream.onPartial((t) => seen.push(t));
    for (let k = 0; k < perChunk.length; k += 1) {
      stream.sendAudio(CHUNK);
      await waitFor(() => seen.length >= k + 1);
    }
    expect(seen).toEqual(['hel', 'hello', 'hello wor']);

    await expect(stream.finalize()).resolves.toBe('hello world');
  });

  it('surfaces a mid-stream Deepgram Error to onError as AsrError', async () => {
    const { stream } = await harness({
      onAudio: (conn) => conn.sendError('server overloaded'),
    });
    const errors: AsrError[] = [];
    stream.onError((err) => errors.push(err));
    stream.sendAudio(CHUNK);
    await waitFor(() => errors.length >= 1);
    expect(errors[0]).toBeInstanceOf(AsrError);
    expect(errors[0]!.message).toContain('server overloaded');
  });

  it('rejects finalize() with AsrTimeoutError when the server never flushes', async () => {
    const { stream } = await harness(
      { onCloseStream: () => {} /* never respond */ },
      { finalizeTimeoutMs: 100 },
    );
    await expect(stream.finalize()).rejects.toBeInstanceOf(AsrTimeoutError);
  });

  it('resolves finalize() with an empty string when no audio was sent (silence)', async () => {
    const { stream } = await harness({
      onCloseStream: (conn) => conn.sendMetadata(),
    });
    await expect(stream.finalize()).resolves.toBe('');
  });

  it('memoizes finalize() — repeated calls share one settlement', async () => {
    const { stream } = await harness({
      onCloseStream: (conn) => {
        conn.sendResults('done', { isFinal: true });
        conn.sendMetadata();
      },
    });
    const a = stream.finalize();
    const b = stream.finalize();
    expect(a).toBe(b);
    await expect(a).resolves.toBe('done');
  });
});

describe('DeepgramASRProvider stream lifecycle', () => {
  it('throws AsrStreamClosedError on sendAudio after close', async () => {
    const { stream } = await harness({});
    stream.close();
    expect(() => stream.sendAudio(CHUNK)).toThrow(AsrStreamClosedError);
  });

  it('is idempotent under double close', async () => {
    const { stream } = await harness({});
    stream.close();
    expect(() => stream.close()).not.toThrow();
  });
});

// ── ONE real-API integration test — skipped without a key, keyless CI stays green ──────────
describe.skipIf(!process.env.DEEPGRAM_API_KEY)('DeepgramASRProvider real API', () => {
  it('connects, streams silence, and finalizes to a string', async () => {
    const provider = new DeepgramASRProvider({ apiKey: process.env.DEEPGRAM_API_KEY as string });
    const stream = await provider.startStream(OPTS);
    // ~200ms of silence (16000 * 0.2 samples * 2 bytes) in 20ms frames.
    for (let n = 0; n < 10; n += 1) stream.sendAudio(new Uint8Array(640));
    const final = await stream.finalize();
    expect(typeof final).toBe('string');
    stream.close();
  }, 15000);
});
