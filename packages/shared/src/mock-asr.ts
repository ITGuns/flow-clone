// MockASRProvider — CONTRACTS.md §2.1, ARCHITECTURE.md §5. A keyless, fixture-driven
// implementation of the ASRProvider surface. It streams canned cumulative partials with
// realistic 30–120ms jitter, then resolves finalize() with the fixture's final transcript.
//
// Determinism is a first-class concern: both the jitter source (RNG) and the timer source
// (clock) are injectable, so tests drive it with a fixed RNG under vitest fake timers and
// never sleep for real. In production/E2E the defaults (Math.random + global timers) give
// lifelike pacing. This is the ASR half of MOCK_MODE=1 and doubles as the golden-set/E2E
// input source, so fixture transcripts read like real ASR output: lowercase, no punctuation.
import type { ASRProvider, ASRStream, ASRStreamOptions } from './asr';
import { AsrStreamClosedError, AsrTimeoutError, type AsrError } from './errors';

import shortFixture from '../fixtures/asr/short.json';
import longFixture from '../fixtures/asr/long.json';
import disfluenciesFixture from '../fixtures/asr/disfluencies.json';
import commandsFixture from '../fixtures/asr/commands.json';
import properNounsFixture from '../fixtures/asr/proper-nouns.json';
import silenceFixture from '../fixtures/asr/silence.json';

/** A single canned utterance. `partials` are cumulative (each extends the previous). */
export interface ASRFixture {
  id: string;
  partials: string[];
  final: string;
}

/** The fixtures bundled with the package. Declaration order is the round-robin order. */
export const BUNDLED_ASR_FIXTURES: readonly ASRFixture[] = Object.freeze([
  shortFixture,
  longFixture,
  disfluenciesFixture,
  commandsFixture,
  properNounsFixture,
  silenceFixture,
]);

/** Deterministic [0,1) generator. Injected so jitter is reproducible under test. */
export type Rng = () => number;

/** Opaque timer handle. `number` in the DOM lib this package compiles against. */
type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Minimal timer surface. The default binds to the global timers, which vitest fake timers
 * replace transparently — so tests never sleep for real.
 */
export interface MockClock {
  setTimeout(handler: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const DEFAULT_CLOCK: MockClock = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle);
  },
};

/** Contract-fixed finalize deadline (CONTRACTS.md §2.1): reject with AsrTimeoutError after this. */
const FINALIZE_TIMEOUT_MS = 2000;

const DEFAULTS = {
  finalizeDelayMs: 150, // inside ARCHITECTURE hop-3's 300ms ASR-finalize budget
  minPartialGapMs: 30,
  maxPartialGapMs: 120,
} as const;

export interface MockASRProviderOptions {
  /** Jitter source. Default Math.random. */
  rng?: Rng;
  /** Timer source. Default global timers (fake-timer friendly). */
  clock?: MockClock;
  /** Delay before finalize() resolves. Default 150ms; set ≥2000 to exercise the timeout path. */
  finalizeDelayMs?: number;
  /** Lower bound of inter-partial jitter. Default 30ms. */
  minPartialGapMs?: number;
  /** Upper bound of inter-partial jitter. Default 120ms. */
  maxPartialGapMs?: number;
  /**
   * Fixture selection per stream. Default round-robin over the fixture set by stream index.
   * `startStream` cannot carry a fixture id (the interface is frozen), so selection lives here.
   */
  pick?: (fixtures: readonly ASRFixture[], streamIndex: number) => ASRFixture;
}

interface ResolvedConfig {
  rng: Rng;
  clock: MockClock;
  finalizeDelayMs: number;
  minPartialGapMs: number;
  maxPartialGapMs: number;
}

export class MockASRProvider implements ASRProvider {
  readonly #fixtures: readonly ASRFixture[];
  readonly #config: ResolvedConfig;
  readonly #pick: (fixtures: readonly ASRFixture[], streamIndex: number) => ASRFixture;
  #streamIndex = 0;

  constructor(
    fixtures: readonly ASRFixture[] = BUNDLED_ASR_FIXTURES,
    options: MockASRProviderOptions = {},
  ) {
    if (fixtures.length === 0) {
      throw new Error('MockASRProvider requires at least one fixture');
    }
    const minGap = options.minPartialGapMs ?? DEFAULTS.minPartialGapMs;
    const maxGap = options.maxPartialGapMs ?? DEFAULTS.maxPartialGapMs;
    if (minGap < 0 || maxGap < minGap) {
      throw new Error('MockASRProvider requires 0 <= minPartialGapMs <= maxPartialGapMs');
    }
    this.#fixtures = fixtures;
    this.#config = {
      rng: options.rng ?? Math.random,
      clock: options.clock ?? DEFAULT_CLOCK,
      finalizeDelayMs: options.finalizeDelayMs ?? DEFAULTS.finalizeDelayMs,
      minPartialGapMs: minGap,
      maxPartialGapMs: maxGap,
    };
    this.#pick = options.pick ?? ((fx, index) => fx[index % fx.length] as ASRFixture);
  }

  startStream(_opts: ASRStreamOptions): Promise<ASRStream> {
    const fixture = this.#pick(this.#fixtures, this.#streamIndex);
    this.#streamIndex += 1;
    return Promise.resolve(new MockASRStream(fixture, this.#config));
  }
}

class MockASRStream implements ASRStream {
  readonly #fixture: ASRFixture;
  readonly #config: ResolvedConfig;
  #partialCb: ((text: string) => void) | undefined;
  #partialIndex = 0;
  #partialTimer: TimerHandle | undefined;
  #closed = false;
  #finalizePromise: Promise<string> | undefined;

  constructor(fixture: ASRFixture, config: ResolvedConfig) {
    this.#fixture = fixture;
    this.#config = config;
    this.#scheduleNextPartial();
  }

  #nextGapMs(): number {
    const { minPartialGapMs, maxPartialGapMs, rng } = this.#config;
    const span = maxPartialGapMs - minPartialGapMs;
    return minPartialGapMs + rng() * span;
  }

  #scheduleNextPartial(): void {
    if (this.#partialIndex >= this.#fixture.partials.length) return;
    const handle = this.#config.clock.setTimeout(() => {
      this.#partialTimer = undefined;
      if (this.#closed || this.#finalizePromise !== undefined) return;
      const text = this.#fixture.partials[this.#partialIndex] as string;
      this.#partialIndex += 1;
      // Cumulative-partial semantics (§2.1): each call replaces the previous partial.
      this.#partialCb?.(text);
      this.#scheduleNextPartial();
    }, this.#nextGapMs());
    this.#partialTimer = handle;
  }

  #cancelPartials(): void {
    if (this.#partialTimer !== undefined) {
      this.#config.clock.clearTimeout(this.#partialTimer);
      this.#partialTimer = undefined;
    }
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.#closed) throw new AsrStreamClosedError();
    // The mock is fixture-driven and ignores audio content; the type keeps the seam honest.
    void chunk;
  }

  finalize(): Promise<string> {
    if (this.#finalizePromise !== undefined) return this.#finalizePromise;
    // Flush: stop emitting partials, then settle on the final transcript.
    this.#cancelPartials();
    const { clock, finalizeDelayMs } = this.#config;
    this.#finalizePromise = new Promise<string>((resolve, reject) => {
      let settled = false;
      const handles: { timeout?: TimerHandle; done?: TimerHandle } = {};
      handles.timeout = clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (handles.done !== undefined) clock.clearTimeout(handles.done);
        reject(new AsrTimeoutError());
      }, FINALIZE_TIMEOUT_MS);
      handles.done = clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (handles.timeout !== undefined) clock.clearTimeout(handles.timeout);
        resolve(this.#fixture.final);
      }, finalizeDelayMs);
    });
    return this.#finalizePromise;
  }

  onPartial(cb: (text: string) => void): void {
    this.#partialCb = cb;
  }

  onError(_cb: (err: AsrError) => void): void {
    // The mock never surfaces provider errors; the hook exists to satisfy the interface.
  }

  close(): void {
    if (this.#closed) return; // idempotent
    this.#closed = true;
    this.#cancelPartials();
  }
}
