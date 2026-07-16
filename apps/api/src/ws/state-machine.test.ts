import { describe, it, expect } from 'vitest';
import { SessionStateMachine } from './state-machine';

describe('SessionStateMachine — §3 mirror', () => {
  it('walks the full happy path idle→…→idle', () => {
    const m = new SessionStateMachine();
    expect(m.state).toBe('idle');
    expect(m.dispatch('utterance.start')).toEqual({ kind: 'ok', state: 'arming' });
    expect(m.dispatch('audio.frame')).toEqual({ kind: 'ok', state: 'listening' });
    expect(m.dispatch('audio.frame')).toEqual({ kind: 'ok', state: 'listening' }); // self-loop
    expect(m.dispatch('audio.end')).toEqual({ kind: 'ok', state: 'finalizing' });
    expect(m.dispatch('asr.final')).toEqual({ kind: 'ok', state: 'formatting' });
    expect(m.dispatch('format.delta')).toEqual({ kind: 'ok', state: 'injecting' });
    expect(m.dispatch('format.done')).toEqual({ kind: 'ok', state: 'idle' });
  });

  it('allows the short-utterance path formatting→idle (format.done, no deltas)', () => {
    const m = new SessionStateMachine();
    m.dispatch('utterance.start');
    m.dispatch('audio.frame');
    m.dispatch('audio.end');
    m.dispatch('asr.final');
    expect(m.state).toBe('formatting');
    expect(m.dispatch('format.done')).toEqual({ kind: 'ok', state: 'idle' });
  });

  it('ignores a re-entrant key-down (utterance.start while busy) — no re-entrancy in v1', () => {
    const m = new SessionStateMachine();
    m.dispatch('utterance.start');
    m.dispatch('audio.frame'); // listening
    expect(m.dispatch('utterance.start')).toEqual({ kind: 'ignored' });
    expect(m.state).toBe('listening');
  });

  it('flags illegal transitions', () => {
    expect(new SessionStateMachine().dispatch('audio.frame')).toEqual({ kind: 'illegal' });
    expect(new SessionStateMachine().dispatch('audio.end')).toEqual({ kind: 'illegal' });
    const m = new SessionStateMachine();
    m.dispatch('utterance.start');
    expect(m.dispatch('asr.final')).toEqual({ kind: 'illegal' }); // arming can't finalize ASR
  });

  it('any state → error, then error → idle', () => {
    const m = new SessionStateMachine();
    m.dispatch('utterance.start');
    expect(m.toError()).toBe('error');
    m.reset('idle');
    expect(m.state).toBe('idle');
  });

  it('goes listening|finalizing → buffering on transport loss', () => {
    const m = new SessionStateMachine();
    m.dispatch('utterance.start');
    m.dispatch('audio.frame');
    expect(m.dispatch('transport.loss')).toEqual({ kind: 'ok', state: 'buffering' });
  });
});
