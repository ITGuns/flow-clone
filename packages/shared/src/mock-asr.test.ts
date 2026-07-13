import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockASRProvider,
  BUNDLED_ASR_FIXTURES,
  type ASRFixture,
  type ASRStreamOptions,
} from './index';
import { AsrStreamClosedError, AsrTimeoutError } from './errors';

const OPTS: ASRStreamOptions = {
  sampleRate: 16000,
  encoding: 'linear16',
  channels: 1,
  locale: 'en-US',
};

// A fixed RNG makes jitter deterministic: 0.5 → the midpoint of every [min,max] gap.
const midRng = () => 0.5;

const twoFixtures: ASRFixture[] = [
  { id: 'a', partials: ['he', 'hello'], final: 'hello' },
  { id: 'b', partials: ['by', 'bye'], final: 'bye' },
];

describe('MockASRProvider construction', () => {
  it('throws when constructed with an empty fixture set', () => {
    expect(() => new MockASRProvider([])).toThrow(/at least one fixture/);
  });

  it('rejects an inverted jitter window', () => {
    expect(
      () => new MockASRProvider(twoFixtures, { minPartialGapMs: 120, maxPartialGapMs: 30 }),
    ).toThrow(/minPartialGapMs/);
  });

  it('defaults to the bundled fixtures', async () => {
    const provider = new MockASRProvider();
    const stream = await provider.startStream(OPTS);
    expect(stream).toBeDefined();
    stream.close();
  });
});

describe('bundled fixtures', () => {
  it('ships at least six fixtures with unique ids', () => {
    expect(BUNDLED_ASR_FIXTURES.length).toBeGreaterThanOrEqual(6);
    const ids = BUNDLED_ASR_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the required scenarios', () => {
    const ids = BUNDLED_ASR_FIXTURES.map((f) => f.id);
    for (const id of ['short', 'long', 'disfluencies', 'commands', 'proper-nouns', 'silence']) {
      expect(ids).toContain(id);
    }
  });

  it('reads like raw ASR output: lowercase, no sentence punctuation', () => {
    for (const fixture of BUNDLED_ASR_FIXTURES) {
      const lines = [fixture.final, ...fixture.partials];
      for (const line of lines) {
        expect(line).toBe(line.toLowerCase());
        expect(line).not.toMatch(/[.,!?;:"']/);
      }
    }
  });

  it('keeps partials cumulative (each extends the previous) and consistent with the final', () => {
    for (const fixture of BUNDLED_ASR_FIXTURES) {
      for (let i = 1; i < fixture.partials.length; i += 1) {
        expect(fixture.partials[i]!.startsWith(fixture.partials[i - 1]!)).toBe(true);
      }
      if (fixture.partials.length > 0) {
        expect(fixture.final.startsWith(fixture.partials[fixture.partials.length - 1]!)).toBe(true);
      }
    }
  });

  it('has an empty/silence fixture with no partials and an empty final', () => {
    const silence = BUNDLED_ASR_FIXTURES.find((f) => f.id === 'silence')!;
    expect(silence.partials).toEqual([]);
    expect(silence.final).toBe('');
  });
});

describe('MockASRProvider streaming (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits cumulative partials with midpoint jitter, replacing the previous each time', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng });
    const stream = await provider.startStream(OPTS);
    const seen: string[] = [];
    stream.onPartial((t) => seen.push(t));

    // No partial before the first gap elapses (30 + 0.5*90 = 75ms).
    await vi.advanceTimersByTimeAsync(74);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(['he']);
    await vi.advanceTimersByTimeAsync(75);
    expect(seen).toEqual(['he', 'hello']);

    stream.close();
  });

  it('keeps every inter-partial gap within [30,120] for extreme RNG values', async () => {
    for (const rngValue of [0, 0.999999]) {
      const provider = new MockASRProvider([twoFixtures[0]!], { rng: () => rngValue });
      const stream = await provider.startStream(OPTS);
      const seen: string[] = [];
      stream.onPartial((t) => seen.push(t));

      await vi.advanceTimersByTimeAsync(29);
      expect(seen).toEqual([]); // never earlier than the 30ms floor
      await vi.advanceTimersByTimeAsync(91); // by 120ms total the ceiling has passed
      expect(seen).toContain('he');
      stream.close();
    }
  });

  it('finalize() resolves with the fixture final after the configured delay', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng, finalizeDelayMs: 150 });
    const stream = await provider.startStream(OPTS);
    const promise = stream.finalize();
    await vi.advanceTimersByTimeAsync(149);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('hello');
    stream.close();
  });

  it('finalize() rejects with AsrTimeoutError at 2000ms when the delay exceeds it', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng, finalizeDelayMs: 2500 });
    const stream = await provider.startStream(OPTS);
    const promise = stream.finalize();
    const assertion = expect(promise).rejects.toBeInstanceOf(AsrTimeoutError);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    stream.close();
  });

  it('finalize() flushes pending partials — none fire after finalize begins', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng, finalizeDelayMs: 150 });
    const stream = await provider.startStream(OPTS);
    const seen: string[] = [];
    stream.onPartial((t) => seen.push(t));
    const promise = stream.finalize(); // before any partial timer fires
    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toBe('hello');
    expect(seen).toEqual([]);
    stream.close();
  });

  it('finalize() is memoized — repeated calls return the same promise', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng, finalizeDelayMs: 150 });
    const stream = await provider.startStream(OPTS);
    const a = stream.finalize();
    const b = stream.finalize();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(150);
    await expect(a).resolves.toBe('hello');
    stream.close();
  });

  it('resolves finalize() with an empty string for the silence fixture', async () => {
    const silence = BUNDLED_ASR_FIXTURES.find((f) => f.id === 'silence')!;
    const provider = new MockASRProvider([silence], { rng: midRng, finalizeDelayMs: 150 });
    const stream = await provider.startStream(OPTS);
    const seen: string[] = [];
    stream.onPartial((t) => seen.push(t));
    const promise = stream.finalize();
    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toBe('');
    expect(seen).toEqual([]);
    stream.close();
  });
});

describe('MockASRProvider stream lifecycle', () => {
  it('throws AsrStreamClosedError on sendAudio after close', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng });
    const stream = await provider.startStream(OPTS);
    stream.close();
    expect(() => stream.sendAudio(new Uint8Array([0, 0]))).toThrow(AsrStreamClosedError);
  });

  it('accepts sendAudio while open (content ignored)', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng });
    const stream = await provider.startStream(OPTS);
    expect(() => stream.sendAudio(new Uint8Array(640))).not.toThrow();
    stream.close();
  });

  it('is idempotent under double close', async () => {
    const provider = new MockASRProvider(twoFixtures, { rng: midRng });
    const stream = await provider.startStream(OPTS);
    stream.close();
    expect(() => stream.close()).not.toThrow();
  });
});

describe('MockASRProvider fixture selection', () => {
  it('round-robins fixtures across successive streams by default', async () => {
    vi.useFakeTimers();
    try {
      const provider = new MockASRProvider(twoFixtures, { rng: midRng, finalizeDelayMs: 1 });
      const finals: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const stream = await provider.startStream(OPTS);
        const p = stream.finalize();
        await vi.advanceTimersByTimeAsync(1);
        finals.push(await p);
        stream.close();
      }
      expect(finals).toEqual(['hello', 'bye', 'hello', 'bye']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors a custom pick selector', async () => {
    vi.useFakeTimers();
    try {
      const provider = new MockASRProvider(twoFixtures, {
        rng: midRng,
        finalizeDelayMs: 1,
        pick: (fx) => fx[1]!,
      });
      const stream = await provider.startStream(OPTS);
      const p = stream.finalize();
      await vi.advanceTimersByTimeAsync(1);
      await expect(p).resolves.toBe('bye');
      stream.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
