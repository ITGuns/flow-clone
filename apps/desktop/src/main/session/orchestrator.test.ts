import { describe, expect, it } from 'vitest';
import type { AppContext, FormatDoneMessage, TranscriptFinalMessage } from '@undertone/shared';
import type { BufferedUtterance } from './ports';
import { SessionOrchestrator, type SessionOrchestratorOptions } from './orchestrator';
import {
  FakeAppDetect,
  FakeCaptureFactory,
  FakeClock,
  FakeHotkey,
  FakeInject,
  FakeWs,
  HudRecorder,
  settle,
} from './fakes';

const HUD_DONE = 800; // default HUD_DONE_DISMISS_MS

function harness(options: Partial<SessionOrchestratorOptions> = {}) {
  const hotkey = new FakeHotkey();
  const captureFactory = new FakeCaptureFactory();
  const ws = new FakeWs();
  const inject = new FakeInject();
  const appDetect = new FakeAppDetect();
  const hud = new HudRecorder();
  const clock = new FakeClock();
  const orch = new SessionOrchestrator(
    { hotkey, createCapture: captureFactory.create, ws, inject, appDetect, hud: hud.sink },
    { accelerator: 'CommandOrControl+Space', clock, createSessionId: () => 'sess-1', ...options },
  );
  return { hotkey, captureFactory, ws, inject, appDetect, hud, clock, orch };
}

const final = (text: string, utteranceId = 1): TranscriptFinalMessage => ({
  t: 'transcript.final',
  utteranceId,
  text,
  asrMs: 100,
});
const done = (text: string, utteranceId = 1): FormatDoneMessage => ({
  t: 'format.done',
  utteranceId,
  text,
  wordCount: text.trim().split(/\s+/).length,
  timings: {},
});

describe('SessionOrchestrator — lifecycle & happy path', () => {
  it('registers the hotkey and connects the WS on start', async () => {
    const { orch, hotkey, ws } = harness();
    await orch.start();
    expect(hotkey.registrations).toBe(1);
    expect(ws.connects).toBe(1);
  });

  it('runs the full short-utterance path with HUD emissions in order', async () => {
    const { orch, hotkey, captureFactory, ws, inject, hud, clock } = harness();
    await orch.start();

    // key-down → arming (HUD listening immediately), appContext captured, session+utterance start.
    hotkey.down();
    await settle();
    expect(orch.getState()).toBe('arming');
    const start = ws.controlsOfType('session.start');
    expect(start).toHaveLength(1);
    expect(start[0]?.sessionId).toBe('sess-1');
    expect((start[0]?.appContext as AppContext).register).toBe('chat'); // slack.exe → chat
    const uStart = ws.controlsOfType('utterance.start');
    expect(uStart).toHaveLength(1);
    expect(uStart[0]?.utteranceId).toBe(1);

    const cap = captureFactory.last;
    expect(cap.started).toBe(true);

    // frames flow: first frame moves arming → listening; VAD drives the meter.
    cap.emitVad(0.5);
    cap.emitFrame();
    expect(orch.getState()).toBe('listening');
    cap.emitFrame();
    cap.tailFrame = new Uint8Array(640); // flushed on stop(), like AudioCapture
    expect(ws.frames).toHaveLength(2);

    // key-up → finalizing (HUD thinking); tail frame flushed; audio.end names the last seq.
    hotkey.up();
    await settle();
    expect(orch.getState()).toBe('finalizing');
    expect(ws.frames).toHaveLength(3); // 2 + flushed tail
    const audioEnd = ws.controlsOfType('audio.end');
    expect(audioEnd[0]).toEqual({ t: 'audio.end', utteranceId: 1, lastFrameSeq: 2 });

    // transcript.final → formatting; format.done (short) → single inject → done.
    ws.server('transcript.final', final('hello world'));
    expect(orch.getState()).toBe('formatting');
    ws.server('format.done', done('Hello world.'));
    await settle();

    expect(inject.calls).toEqual(['Hello world.']);
    expect(orch.getState()).toBe('idle');
    expect(hud.last.phase).toBe('done');
    expect(hud.phaseSequence).toEqual(['listening', 'thinking', 'done']);

    // auto-dismiss after 800ms → hidden.
    clock.advance(HUD_DONE);
    expect(hud.last.phase).toBe('hidden');
  });

  it('assigns u16 monotonic utteranceIds and sends session.start only once', async () => {
    const { orch, hotkey, ws, captureFactory, inject } = harness();
    await orch.start();

    for (let n = 1; n <= 2; n += 1) {
      hotkey.down();
      await settle();
      captureFactory.last.emitFrame();
      hotkey.up();
      await settle();
      ws.server('transcript.final', final('hi', n));
      ws.server('format.done', done('Hi.', n));
      await settle();
    }
    expect(ws.controlsOfType('session.start')).toHaveLength(1);
    expect(ws.controlsOfType('utterance.start').map((m) => m.utteranceId)).toEqual([1, 2]);
    expect(inject.calls).toEqual(['Hi.', 'Hi.']);
  });
});

describe('SessionOrchestrator — streamed vs single injection', () => {
  it('streams sentence chunks for long utterances and injects the remainder on done', async () => {
    const { orch, hotkey, captureFactory, ws, inject } = harness();
    await orch.start();
    hotkey.down();
    await settle();
    captureFactory.last.emitFrame();
    hotkey.up();
    await settle();
    ws.server('transcript.final', final('long dictation'));

    const d1 = 'One two three four five six seven eight. ';
    const d2 = 'Nine ten eleven twelve thirteen fourteen fifteen sixteen. ';
    const d3 = 'Seventeen eighteen nineteen.';
    ws.server('format.delta', { t: 'format.delta', utteranceId: 1, text: d1 });
    ws.server('format.delta', { t: 'format.delta', utteranceId: 1, text: d2 });
    ws.server('format.delta', { t: 'format.delta', utteranceId: 1, text: d3 });
    const finalText = d1 + d2 + d3;
    ws.server('format.done', done(finalText));
    await settle();

    // Two injects: the completed sentences streamed once past the threshold, then the remainder.
    expect(inject.calls).toHaveLength(2);
    expect(inject.calls[0]).toBe(d1 + d2); // ends on a sentence boundary
    expect(inject.calls[0]?.endsWith('. ')).toBe(true);
    expect(inject.injected).toBe(finalText);
    expect(orch.getState()).toBe('idle');
  });

  it('does a single inject when a long utterance has no sentence boundary until done', async () => {
    const { orch, hotkey, captureFactory, ws, inject } = harness();
    await orch.start();
    hotkey.down();
    await settle();
    captureFactory.last.emitFrame();
    hotkey.up();
    await settle();
    ws.server('transcript.final', final('x'));
    // 18 words, no boundary anywhere in the stream.
    const text = 'a b c d e f g h i j k l m n o p q r';
    ws.server('format.delta', { t: 'format.delta', utteranceId: 1, text });
    ws.server('format.done', done(text));
    await settle();
    expect(inject.calls).toEqual([text]);
    void orch;
  });
});

describe('SessionOrchestrator — re-entrancy guards', () => {
  it('ignores key-down while an utterance is active', async () => {
    const { orch, hotkey, captureFactory, ws } = harness();
    await orch.start();
    hotkey.down();
    await settle();
    hotkey.down(); // ignored — already arming/listening
    await settle();
    expect(captureFactory.created).toHaveLength(1);
    expect(ws.controlsOfType('utterance.start')).toHaveLength(1);
  });

  it('ignores a double key-up (only one audio.end)', async () => {
    const { orch, hotkey, captureFactory, ws } = harness();
    await orch.start();
    hotkey.down();
    await settle();
    captureFactory.last.emitFrame();
    hotkey.up();
    await settle();
    hotkey.up(); // ignored — state is finalizing
    await settle();
    expect(ws.controlsOfType('audio.end')).toHaveLength(1);
    void orch;
  });

  it('finalizes a tap released during arming (before capture started)', async () => {
    const { orch, hotkey, ws } = harness();
    await orch.start();
    hotkey.down(); // arm() runs to its first await; capture not started yet
    hotkey.up(); // release while arming → deferred finalize
    expect(orch.getState()).toBe('arming');
    await settle();
    expect(ws.controlsOfType('audio.end')).toHaveLength(1);
    expect(orch.getState()).toBe('finalizing');
  });
});

describe('SessionOrchestrator — §8 error mappings', () => {
  async function toFormatting(h = harness()) {
    const { orch, hotkey, captureFactory, ws } = h;
    await orch.start();
    hotkey.down();
    await settle();
    captureFactory.last.emitFrame();
    hotkey.up();
    await settle();
    ws.server('transcript.final', final('some words'));
    return h;
  }

  it('INJECT_FAILED (native ok:false) → error HUD, no clipboard here', async () => {
    const h = await toFormatting();
    h.inject.alwaysFail('INJECT_FAILED');
    h.ws.server('format.done', done('Some words.'));
    await settle();
    expect(h.orch.getState()).toBe('error');
    expect(h.hud.last.phase).toBe('error');
    expect(h.hud.last.errorCode).toBe('INJECT_FAILED');
    expect(h.hud.last.recoverable).toBe(false);
  });

  it('FORMAT_UNAVAILABLE → inject RAW transcript, then unformatted error flavor', async () => {
    const h = await toFormatting();
    h.ws.errorCode('FORMAT_UNAVAILABLE', 1, true); // arrives with the raw format.done
    h.ws.server('format.done', done('some words')); // raw, unformatted
    await settle();
    expect(h.inject.injected).toBe('some words'); // words never lost
    expect(h.hud.last.phase).toBe('error');
    expect(h.hud.last.errorCode).toBe('FORMAT_UNAVAILABLE');
  });

  it('FORMAT_TIMEOUT → same raw-injection fallback', async () => {
    const h = await toFormatting();
    h.ws.errorCode('FORMAT_TIMEOUT', 1, true);
    h.ws.server('format.done', done('some words'));
    await settle();
    expect(h.inject.injected).toBe('some words');
    expect(h.hud.last.errorCode).toBe('FORMAT_TIMEOUT');
  });

  it('OFFLINE_BUFFERED on a rejected frame → buffering + seam event, recoverable HUD', async () => {
    const h = harness();
    const buffered: BufferedUtterance[] = [];
    h.orch.onBuffered((info) => buffered.push(info));
    await h.orch.start();
    h.ws.rejectFrames = true; // ring full → sendFrame false + OFFLINE_BUFFERED error
    h.hotkey.down();
    await settle();
    h.captureFactory.last.emitFrame();
    await settle();
    expect(h.orch.getState()).toBe('buffering');
    expect(h.hud.last.phase).toBe('error');
    expect(h.hud.last.errorCode).toBe('OFFLINE_BUFFERED');
    expect(h.hud.last.recoverable).toBe(true);
    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({ utteranceId: 1, reason: 'OFFLINE_BUFFERED' });
    expect(buffered[0]?.appContext.register).toBe('chat');
  });

  it('transport loss mid-capture (ws → buffering) → buffering + seam via BufferSink port', async () => {
    const buffered: BufferedUtterance[] = [];
    const h = harness({ bufferSink: { bufferUtterance: (i) => buffered.push(i) } });
    await h.orch.start();
    h.hotkey.down();
    await settle();
    h.captureFactory.last.emitFrame(); // now listening
    h.ws.setState('buffering'); // transport dropped mid-utterance
    expect(h.orch.getState()).toBe('buffering');
    expect(h.hud.last.recoverable).toBe(true);
    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({ utteranceId: 1, reason: 'OFFLINE_BUFFERED' });
  });

  it('empty transcript (silence) → graceful idle, no injection', async () => {
    const g = harness();
    await g.orch.start();
    g.hotkey.down();
    await settle();
    g.captureFactory.last.emitFrame();
    g.hotkey.up();
    await settle();
    g.ws.server('transcript.final', final(''));
    await settle();
    expect(g.inject.calls).toHaveLength(0);
    expect(g.orch.getState()).toBe('idle');
    expect(g.hud.last.phase).toBe('hidden');
  });

  it('a capture pipeline error surfaces as an error HUD', async () => {
    const h = harness();
    await h.orch.start();
    h.hotkey.down();
    await settle();
    h.captureFactory.last.emitError(new Error('device lost'));
    expect(h.orch.getState()).toBe('error');
    expect(h.hud.last.phase).toBe('error');
    expect(h.hud.last.errorCode).toBe('INTERNAL');
  });
});

describe('SessionOrchestrator — HUD level throttling', () => {
  it('caps level pushes to ≤ 30/sec', async () => {
    const { orch, hotkey, captureFactory, hud, clock } = harness();
    await orch.start();
    hotkey.down();
    await settle();
    const cap = captureFactory.last;
    cap.emitFrame(); // listening

    const before = hud.states.length;
    // 100 VAD frames over ~1000ms of virtual time (10ms apart, ~50/s worth of frames).
    for (let i = 0; i < 100; i += 1) {
      cap.emitVad((i % 50) / 50 + 0.01);
      clock.advance(10);
    }
    const levelPushes = hud.states.length - before;
    expect(levelPushes).toBeLessThanOrEqual(30);
    expect(levelPushes).toBeGreaterThan(10); // but the meter still moves
  });
});

describe('SessionOrchestrator — auto-dismiss timing', () => {
  it('holds "done" for the configured window then hides', async () => {
    const { orch, hotkey, captureFactory, ws, hud, clock } = harness({ doneDismissMs: 500 });
    await orch.start();
    hotkey.down();
    await settle();
    captureFactory.last.emitFrame();
    hotkey.up();
    await settle();
    ws.server('transcript.final', final('hi'));
    ws.server('format.done', done('Hi.'));
    await settle();
    expect(hud.last.phase).toBe('done');
    clock.advance(499);
    expect(hud.last.phase).toBe('done');
    clock.advance(1);
    expect(hud.last.phase).toBe('hidden');
  });

  it('a new key-down during the "done" window cancels the dismiss and re-arms', async () => {
    const { orch, hotkey, captureFactory, ws, hud, clock } = harness();
    await orch.start();
    hotkey.down();
    await settle();
    captureFactory.last.emitFrame();
    hotkey.up();
    await settle();
    ws.server('transcript.final', final('hi'));
    ws.server('format.done', done('Hi.'));
    await settle();
    expect(hud.last.phase).toBe('done');

    hotkey.down(); // re-arm during the done window
    await settle();
    expect(orch.getState()).toBe('arming');
    clock.advance(2000); // the stale dismiss must not fire and hide the live listening HUD
    expect(hud.last.phase).toBe('listening');
  });
});
