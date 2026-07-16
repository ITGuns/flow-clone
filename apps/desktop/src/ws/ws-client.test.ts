import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext, ErrorMessage } from '@undertone/shared';
import { WsClient } from './ws-client';
import { FakeConnection, FakeTokenProvider, FakeTransport } from './fake-transport';
import type { ConnectionState, SessionInvalidEvent } from './types';

const APP: AppContext = {
  bundleId: 'slack.exe',
  appName: 'Slack',
  windowTitle: '',
  register: 'chat',
};

function payload(fill = 1): Uint8Array {
  const p = new Uint8Array(640); // 20ms PCM16LE @16kHz mono
  p.fill(fill);
  return p;
}

interface Harness {
  client: WsClient;
  transport: FakeTransport;
  tokenProvider: FakeTokenProvider;
}

function makeClient(overrides: Partial<ConstructorParameters<typeof WsClient>[0]> = {}): Harness {
  const transport = new FakeTransport();
  const tokenProvider = new FakeTokenProvider();
  const client = new WsClient({
    host: 'api.test',
    transport,
    tokenProvider,
    reconnectDelayMs: 10,
    ...overrides,
  });
  return { client, transport, tokenProvider };
}

/** connect → session.start → session.ready → utterance.start; leaves the client in `ready`. */
async function ready(
  h: Harness,
  opts: { sessionId?: string; utteranceId?: number } = {},
): Promise<FakeConnection> {
  const sessionId = opts.sessionId ?? 'sess-1';
  const utteranceId = opts.utteranceId ?? 1;
  await h.client.connect();
  const conn = h.transport.last;
  h.client.sendControl({ t: 'session.start', sessionId, appContext: APP, locale: 'en-US' });
  conn.emit({ t: 'session.ready', sessionId });
  h.client.sendControl({ t: 'utterance.start', utteranceId, appContext: APP });
  return conn;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connection & auth (§4.1)', () => {
  it('builds the wss URL with a fresh token and transitions connecting→connected→ready', async () => {
    const h = makeClient();
    const states: ConnectionState[] = [];
    h.client.on('state', (s) => states.push(s));

    await h.client.connect();
    expect(h.transport.last.url).toBe('wss://api.test/v1/stream?token=tok-1');
    expect(states).toEqual(['connecting', 'connected']);

    h.client.sendControl({
      t: 'session.start',
      sessionId: 'sess-1',
      appContext: APP,
      locale: 'en-US',
    });
    h.transport.last.emit({ t: 'session.ready', sessionId: 'sess-1' });
    expect(states).toEqual(['connecting', 'connected', 'ready']);
    expect(h.client.getState()).toBe('ready');
  });

  it('fetches a FRESH token on every reconnect (§4.1)', async () => {
    const h = makeClient();
    await ready(h);
    h.client.sendFrame(1, payload());

    h.transport.last.serverClose(); // drop mid-utterance
    await vi.advanceTimersByTimeAsync(10); // reconnect delay

    expect(h.transport.count).toBe(2);
    expect(h.tokenProvider.issued).toEqual(['tok-1', 'tok-2']);
    expect(h.transport.last.url).toBe('wss://api.test/v1/stream?token=tok-2');
  });
});

describe('heartbeat (§4.1)', () => {
  it('pings every 15s and reconnects after two missed pongs', async () => {
    const h = makeClient();
    await ready(h);

    await vi.advanceTimersByTimeAsync(15_000); // ping 1
    await vi.advanceTimersByTimeAsync(15_000); // ping 2 (still unanswered)
    const pings = h.transport.last.sentJson.filter((m) => m.t === 'ping');
    expect(pings.length).toBe(2);
    expect(h.transport.count).toBe(1); // not dropped yet

    await vi.advanceTimersByTimeAsync(15_000); // third tick: 2 outstanding → drop
    await vi.advanceTimersByTimeAsync(10); // reconnect delay
    expect(h.transport.count).toBe(2);
  });

  it('a pong resets the missed-pong counter (no reconnect)', async () => {
    const h = makeClient();
    await ready(h);

    await vi.advanceTimersByTimeAsync(15_000); // ping 1
    h.transport.last.emit({ t: 'pong', ts: 1 }); // answered
    await vi.advanceTimersByTimeAsync(15_000); // ping 2
    h.transport.last.emit({ t: 'pong', ts: 2 }); // answered
    await vi.advanceTimersByTimeAsync(15_000); // ping 3

    expect(h.transport.count).toBe(1); // never dropped
  });
});

describe('backpressure (§4.4)', () => {
  it('pauses pushing above the high-water mark and resumes below the low-water mark', async () => {
    const h = makeClient({ backpressureHighWater: 256 * 1024, backpressureLowWater: 64 * 1024 });
    const conn = await ready(h);

    conn.setBufferedAmount(300 * 1024); // above high-water
    h.client.sendFrame(1, payload());
    h.client.sendFrame(1, payload());
    h.client.sendFrame(1, payload());
    expect(h.client.isPaused).toBe(true);
    expect(conn.frames.length).toBe(0); // nothing pushed to the socket
    expect(h.client.bufferedFrameCount).toBe(3); // held locally, never dropped

    conn.setBufferedAmount(30 * 1024); // below low-water
    h.client.sendFrame(1, payload()); // any activity re-drives the pump
    expect(h.client.isPaused).toBe(false);
    expect(conn.sentSeqs).toEqual([0, 1, 2, 3]); // all four flushed, gapless
  });
});

describe('replay ring buffer & acks (§4.4)', () => {
  it('prunes only on ack and stays bounded as the window slides (wraparound)', async () => {
    const h = makeClient({ replayBufferCap: 100 });
    const conn = await ready(h);
    conn.setBufferedAmount(0);

    let rejected = 0;
    for (let i = 0; i < 500; i += 1) {
      const ok = h.client.sendFrame(1, payload(i % 256));
      if (!ok) rejected += 1;
      if (i % 20 === 19) conn.emit({ t: 'audio.ack', utteranceId: 1, frameSeq: i }); // prune ≤ i
    }

    expect(rejected).toBe(0); // pruning kept the ring under cap the whole time
    expect(h.client.bufferedFrameCount).toBeLessThanOrEqual(100);
    // Every frame reached the socket exactly once, in a gapless 0..499 stream.
    expect(conn.sentSeqs).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  it('rejects new frames when the ring is full (1500) and keeps the stream gapless', async () => {
    const h = makeClient(); // default cap 1500
    const conn = await ready(h);
    conn.setBufferedAmount(0);

    const errors: ErrorMessage[] = [];
    h.client.on('error', (e) => errors.push(e));

    for (let i = 0; i < 1500; i += 1) {
      expect(h.client.sendFrame(1, payload())).toBe(true); // never acked → ring fills
    }
    expect(h.client.bufferedFrameCount).toBe(1500);

    // The 1501st frame is rejected and surfaced, without consuming a seq.
    expect(h.client.sendFrame(1, payload())).toBe(false);
    expect(h.client.bufferedFrameCount).toBe(1500);
    expect(errors.some((e) => e.code === 'OFFLINE_BUFFERED')).toBe(true);
    expect(conn.sentSeqs).toEqual(Array.from({ length: 1500 }, (_, i) => i)); // 0..1499, uncorrupted

    // Freeing space lets the NEXT frame take the contiguous seq 1500 (no gap from the rejection).
    conn.emit({ t: 'audio.ack', utteranceId: 1, frameSeq: 100 }); // prune 0..100
    expect(h.client.sendFrame(1, payload())).toBe(true);
    expect(conn.frames[conn.frames.length - 1]!.frameSeq).toBe(1500);
  });
});

describe('reconnect + resume + replay (§4.4)', () => {
  it('resumes with lastAckedFrameSeq and replays a gapless seq stream server-side', async () => {
    const h = makeClient();
    const conn1 = await ready(h, { sessionId: 'sess-1', utteranceId: 1 });
    conn1.setBufferedAmount(0);

    for (let i = 0; i < 10; i += 1) h.client.sendFrame(1, payload(i));
    expect(conn1.sentSeqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    conn1.emit({ t: 'audio.ack', utteranceId: 1, frameSeq: 4 }); // server acked through seq 4
    h.client.sendControl({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 9 });

    conn1.serverClose(); // drop mid-utterance → buffering
    expect(h.client.getState()).toBe('buffering');

    await vi.advanceTimersByTimeAsync(10); // reconnect
    const conn2 = h.transport.last;
    expect(conn2).not.toBe(conn1);

    const resume = conn2.sentJson.find((m) => m.t === 'session.resume');
    expect(resume).toMatchObject({ sessionId: 'sess-1', utteranceId: 1, lastAckedFrameSeq: 4 });

    conn2.setBufferedAmount(0);
    conn2.emit({ t: 'session.ready', sessionId: 'sess-1' }); // triggers replay from lastAcked+1
    expect(conn2.sentSeqs).toEqual([5, 6, 7, 8, 9]); // replayed, gapless
    expect(h.client.getState()).toBe('ready');

    // audio.end was already sent pre-drop → re-announced after resume so the server can finalize.
    expect(conn2.sentJson.filter((m) => m.t === 'audio.end')).toHaveLength(1);

    // Continue the utterance; new frames extend the stream without a gap.
    h.client.sendFrame(1, payload());
    h.client.sendFrame(1, payload());
    expect(conn2.sentSeqs).toEqual([5, 6, 7, 8, 9, 10, 11]);

    // Server-side view = acked frames from conn1 (0..4) + everything conn2 received (5..11) = 0..11.
    const serverStream = [...conn1.sentSeqs.filter((s) => s <= 4), ...conn2.sentSeqs];
    expect(serverStream).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('reconnect uses a fresh token in the resume URL', async () => {
    const h = makeClient();
    const conn1 = await ready(h);
    h.client.sendFrame(1, payload());
    conn1.serverClose();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.transport.last.url).toBe('wss://api.test/v1/stream?token=tok-2');
  });
});

describe('SESSION_INVALID handoff (§4.4 / §8)', () => {
  it('surfaces sessionInvalid to the caller and stops auto-resume', async () => {
    const h = makeClient();
    const conn1 = await ready(h, { sessionId: 'sess-9', utteranceId: 3 });
    h.client.sendFrame(3, payload());

    const invalids: SessionInvalidEvent[] = [];
    const errors: ErrorMessage[] = [];
    h.client.on('sessionInvalid', (e) => invalids.push(e));
    h.client.on('error', (e) => errors.push(e));

    conn1.serverClose();
    await vi.advanceTimersByTimeAsync(10); // reconnect → sends session.resume
    const conn2 = h.transport.last;
    expect(conn2.sentJson.some((m) => m.t === 'session.resume')).toBe(true);

    // Server rejects the resume.
    conn2.emit({
      t: 'error',
      code: 'SESSION_INVALID',
      message: 'unknown session',
      retryable: false,
    });

    expect(invalids).toEqual([{ sessionId: 'sess-9', utteranceId: 3 }]);
    expect(errors.some((e) => e.code === 'SESSION_INVALID')).toBe(true);
    expect(h.client.getState()).toBe('closed');

    // No further reconnect attempts.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.transport.count).toBe(2);
  });
});

describe('error dispatch (§8)', () => {
  it('emits typed error events and leaves retry policy to the caller for RATE_LIMITED', async () => {
    const h = makeClient();
    const conn = await ready(h);
    const errors: ErrorMessage[] = [];
    h.client.on('error', (e) => errors.push(e));

    conn.emit({
      t: 'error',
      code: 'RATE_LIMITED',
      message: 'slow down',
      retryable: true,
      retryAfterMs: 2000,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 2000 });
    expect(h.client.getState()).toBe('ready'); // connection untouched
  });

  it('AUTH_INVALID terminates the client (sign-in required) with no reconnect', async () => {
    const h = makeClient();
    const conn = await ready(h);
    conn.emit({ t: 'error', code: 'AUTH_INVALID', message: 'revoked', retryable: false });

    expect(h.client.getState()).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.transport.count).toBe(1);
  });
});

describe('server message fan-out (§4.3)', () => {
  it('emits a typed event for each server message type', async () => {
    const h = makeClient();
    const conn = await ready(h);
    const seen: string[] = [];
    for (const t of [
      'transcript.partial',
      'transcript.final',
      'format.delta',
      'format.done',
      'usage.update',
    ] as const) {
      h.client.on(t, () => seen.push(t));
    }

    conn.emit({ t: 'transcript.partial', utteranceId: 1, text: 'hel' });
    conn.emit({ t: 'transcript.final', utteranceId: 1, text: 'hello', asrMs: 120 });
    conn.emit({ t: 'format.delta', utteranceId: 1, text: 'Hello' });
    conn.emit({ t: 'format.done', utteranceId: 1, text: 'Hello.', wordCount: 1, timings: {} });
    conn.emit({ t: 'usage.update', wordsThisWeek: 10, limit: 2000 });

    expect(seen).toEqual([
      'transcript.partial',
      'transcript.final',
      'format.delta',
      'format.done',
      'usage.update',
    ]);
  });
});

describe('frame guards', () => {
  it('throws when sendFrame is called without a matching active utterance', async () => {
    const h = makeClient();
    await h.client.connect();
    h.client.sendControl({ t: 'session.start', sessionId: 's', appContext: APP, locale: 'en-US' });
    h.transport.last.emit({ t: 'session.ready', sessionId: 's' });
    expect(() => h.client.sendFrame(1, payload())).toThrow(/without an active utterance/);
  });

  it('resets frameSeq to 0 on each new utterance', async () => {
    const h = makeClient();
    const conn = await ready(h, { utteranceId: 1 });
    conn.setBufferedAmount(0);
    h.client.sendFrame(1, payload());
    h.client.sendFrame(1, payload());
    h.client.sendControl({ t: 'utterance.start', utteranceId: 2, appContext: APP });
    h.client.sendFrame(2, payload());

    expect(conn.frames.map((f) => [f.utteranceId, f.frameSeq])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
  });
});
