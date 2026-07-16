import { describe, it, expect } from 'vitest';
import { latest, sessionReducer, type Utterance } from './session-state';

function run(actions: Parameters<typeof sessionReducer>[1][]): Utterance[] {
  return actions.reduce((state, action) => sessionReducer(state, action), [] as Utterance[]);
}

describe('sessionReducer', () => {
  it('begins with a recording utterance at the head (newest first)', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'begin', id: 2, style: 'chat' },
    ]);
    expect(state.map((u) => u.id)).toEqual([2, 1]);
    expect(latest(state)?.phase).toBe('recording');
  });

  it('moves recording → transcribing on release, before the final lands', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'transcribing', id: 1 },
    ]);
    expect(latest(state)!.phase).toBe('transcribing');
  });

  it('drives partial → final → delta → done', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'transcribing', id: 1 },
      { type: 'partial', id: 1, text: 'hello wor' },
      { type: 'final', id: 1, text: 'hello world' },
      { type: 'delta', id: 1, text: 'Hello ' },
      { type: 'delta', id: 1, text: 'world.' },
      { type: 'done', id: 1, text: 'Hello world.', wordCount: 2, unformatted: false },
    ]);
    const u = latest(state)!;
    expect(u.transcript).toBe('hello world');
    expect(u.text).toBe('Hello world.');
    expect(u.wordCount).toBe(2);
    expect(u.phase).toBe('done');
    expect(u.unformatted).toBe(false);
  });

  it('marks a §8 FORMAT_* fallback as unformatted on done', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'final', id: 1, text: 'raw text here' },
      { type: 'done', id: 1, text: 'raw text here', wordCount: 3, unformatted: true },
    ]);
    expect(latest(state)!.unformatted).toBe(true);
  });

  it('flags §8 QUOTA_EXCEEDED without discarding the delivered result', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'done', id: 1, text: 'Kept.', wordCount: 1, unformatted: false },
      { type: 'quota', id: 1 },
    ]);
    const u = latest(state)!;
    expect(u.quotaExceeded).toBe(true);
    expect(u.text).toBe('Kept.'); // words never eaten
  });

  it('records an error state and message', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'error', id: 1, message: 'ASR unavailable' },
    ]);
    expect(latest(state)!.phase).toBe('error');
    expect(latest(state)!.errorMessage).toBe('ASR unavailable');
  });

  it('only mutates the addressed utterance', () => {
    const state = run([
      { type: 'begin', id: 1, style: 'document' },
      { type: 'begin', id: 2, style: 'email' },
      { type: 'partial', id: 1, text: 'first' },
    ]);
    expect(state.find((u) => u.id === 1)!.partial).toBe('first');
    expect(state.find((u) => u.id === 2)!.partial).toBe('');
  });
});
