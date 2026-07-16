import { describe, it, expect } from 'vitest';
import {
  BrowserRecognizer,
  isBrowserSpeechSupported,
  windowSpeechRecognitionCtor,
  type RecognizerError,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultListLike,
} from './browser-recognizer';

interface Seg {
  transcript: string;
  isFinal: boolean;
}

function resultList(segs: Seg[]): SpeechRecognitionResultListLike {
  const items = segs.map((s) => ({
    isFinal: s.isFinal,
    length: 1,
    item: () => ({ transcript: s.transcript }),
  }));
  return { length: items.length, item: (i: number) => items[i]! };
}

/** A scripted fake of the native SpeechRecognition instance. Maintains a cumulative result list. */
class FakeRecognition implements SpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = '';
  starts = 0;
  stops = 0;
  aborts = 0;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  private results: Seg[] = [];
  private cursor = 0;

  start(): void {
    this.starts += 1;
    this.onstart?.();
  }
  stop(): void {
    this.stops += 1;
  }
  abort(): void {
    this.aborts += 1;
  }

  /** Update the in-progress result with a non-final transcript. */
  interim(text: string): void {
    this.results[this.cursor] = { transcript: text, isFinal: false };
    this.fire(this.cursor);
  }
  /** Finalize the in-progress result; the next phrase starts a fresh result (like the native API). */
  finalize(text: string): void {
    this.results[this.cursor] = { transcript: text, isFinal: true };
    this.fire(this.cursor);
    this.cursor = this.results.length;
  }
  error(error: string, message = ''): void {
    this.onerror?.({ error, message });
  }
  end(): void {
    this.onend?.();
  }

  private fire(resultIndex: number): void {
    this.onresult?.({ resultIndex, results: resultList([...this.results]) });
  }
}

describe('BrowserRecognizer', () => {
  it('configures continuous/interim/lang and starts the injected recognition', () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake, { lang: 'en-GB' });
    rec.start({});
    expect(fake.continuous).toBe(true);
    expect(fake.interimResults).toBe(true);
    expect(fake.lang).toBe('en-GB');
    expect(fake.starts).toBe(1);
    expect(rec.active).toBe(true);
  });

  it('emits cumulative interim text as partial results stream', () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake);
    const interims: string[] = [];
    rec.start({ onInterim: (t) => interims.push(t) });
    fake.interim('hello');
    fake.interim('hello world');
    expect(interims).toEqual(['hello', 'hello world']);
  });

  it('stop() resolves the joined final transcript after onend', async () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake);
    rec.start({});
    fake.finalize('hello world');
    const done = rec.stop();
    expect(fake.stops).toBe(1);
    fake.end();
    await expect(done).resolves.toBe('hello world');
    expect(rec.active).toBe(false);
  });

  it('joins multiple final segments plus a trailing (never-finalized) interim', async () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake);
    rec.start({});
    fake.finalize('First sentence.');
    fake.finalize('Second sentence.');
    fake.interim('trailing words');
    const done = rec.stop();
    fake.end();
    // Never eat words: the un-finalized interim is still included in the resolved transcript.
    await expect(done).resolves.toBe('First sentence. Second sentence. trailing words');
  });

  it('surfaces a recognizer error AND resolves a pending stop with what it captured', async () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake);
    const errors: RecognizerError[] = [];
    rec.start({ onError: (e) => errors.push(e) });
    fake.finalize('kept words');
    const done = rec.stop();
    fake.error('network', 'net down');
    fake.end();
    await expect(done).resolves.toBe('kept words');
    expect(errors).toEqual([{ error: 'network', message: 'net down' }]);
  });

  it('surfaces a start-time error (e.g. permission denied) with no pending stop', () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake);
    const errors: RecognizerError[] = [];
    rec.start({ onError: (e) => errors.push(e) });
    fake.error('not-allowed', 'denied');
    expect(errors).toEqual([{ error: 'not-allowed', message: 'denied' }]);
  });

  it('abort() cancels and swallows the subsequent aborted-error + end', () => {
    const fake = new FakeRecognition();
    const rec = new BrowserRecognizer(() => fake);
    const errors: RecognizerError[] = [];
    rec.start({ onError: (e) => errors.push(e) });
    rec.abort();
    expect(fake.aborts).toBe(1);
    expect(rec.active).toBe(false);
    fake.error('aborted');
    fake.end();
    expect(errors).toEqual([]);
  });

  it('stop() before start (nothing active) resolves an empty transcript', async () => {
    const rec = new BrowserRecognizer(() => new FakeRecognition());
    await expect(rec.stop()).resolves.toBe('');
  });

  it('reports a synchronous start() failure through onError and stays inactive', () => {
    const fake = new FakeRecognition();
    fake.start = () => {
      throw new Error('mic busy');
    };
    const rec = new BrowserRecognizer(() => fake);
    const errors: RecognizerError[] = [];
    rec.start({ onError: (e) => errors.push(e) });
    expect(errors[0]?.error).toBe('start-failed');
    expect(rec.active).toBe(false);
  });
});

describe('windowSpeechRecognitionCtor / isBrowserSpeechSupported', () => {
  it('returns undefined when neither ctor is present (e.g. Firefox)', () => {
    expect(windowSpeechRecognitionCtor({})).toBeUndefined();
    expect(isBrowserSpeechSupported({})).toBe(false);
  });

  it('prefers standard SpeechRecognition, falling back to webkitSpeechRecognition', () => {
    expect(windowSpeechRecognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
    expect(windowSpeechRecognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    );
    expect(isBrowserSpeechSupported({ webkitSpeechRecognition: FakeRecognition })).toBe(true);
  });
});
