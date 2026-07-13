// Per-connection session state machine — CONTRACTS.md §3, server-side mirror.
//
//   idle → arming → listening → finalizing → formatting → injecting → idle
//   (+ error(code), + buffering)
//
// The gateway drives this from a mix of client events (utterance.start, audio frame, audio.end)
// and internal pipeline steps (asr.final, format.delta, format.done). A client event that maps to
// no legal transition is a protocol violation → the gateway emits `PROTO_ERROR` and closes 1002.
// Exception per §3: a key-down (`utterance.start`) while non-idle is *ignored*, not an error
// ("no re-entrancy in v1").

export type SessionState =
  | 'idle'
  | 'arming'
  | 'listening'
  | 'finalizing'
  | 'formatting'
  | 'injecting'
  | 'buffering'
  | 'error';

/** Events the server observes, in §3 vocabulary. */
export type StateEvent =
  | 'utterance.start' // client key-down
  | 'audio.frame' // first accepted frame drives arming→listening; later frames are self-loops
  | 'audio.end' // client key-up
  | 'asr.final' // internal: ASR finalize resolved
  | 'format.delta' // internal: first streamed delta
  | 'format.done' // internal: formatting complete (or short-utterance terminal)
  | 'transport.loss'; // internal: socket dropped mid-capture

export type TransitionOutcome =
  | { kind: 'ok'; state: SessionState }
  | { kind: 'ignored' } // legal-but-no-op (re-entrant key-down)
  | { kind: 'illegal' }; // protocol violation → PROTO_ERROR

/**
 * Enforces §3. `dispatch` returns `ok` (state advanced), `ignored` (legal no-op), or `illegal`
 * (caller must raise PROTO_ERROR). `toError`/`reset` handle the `error(code)` and `error→idle`
 * edges available from any state.
 */
export class SessionStateMachine {
  private current: SessionState = 'idle';

  get state(): SessionState {
    return this.current;
  }

  dispatch(event: StateEvent): TransitionOutcome {
    const from = this.current;
    switch (event) {
      case 'utterance.start':
        // idle → arming; key-down while busy is ignored (no re-entrancy, §3).
        if (from === 'idle') return this.go('arming');
        return { kind: 'ignored' };
      case 'audio.frame':
        // arming → listening on first frame; further frames are self-loops in listening.
        if (from === 'arming') return this.go('listening');
        if (from === 'listening') return { kind: 'ok', state: 'listening' };
        return { kind: 'illegal' };
      case 'audio.end':
        // key-up: listening → finalizing (also allow arming→finalizing for a zero-frame utterance).
        if (from === 'listening' || from === 'arming') return this.go('finalizing');
        return { kind: 'illegal' };
      case 'asr.final':
        if (from === 'finalizing') return this.go('formatting');
        return { kind: 'illegal' };
      case 'format.delta':
        // formatting → injecting on first delta (long-utterance path).
        if (from === 'formatting') return this.go('injecting');
        if (from === 'injecting') return { kind: 'ok', state: 'injecting' };
        return { kind: 'illegal' };
      case 'format.done':
        // injecting → idle (long) or formatting → idle (short utterance, no deltas).
        if (from === 'injecting' || from === 'formatting') return this.go('idle');
        return { kind: 'illegal' };
      case 'transport.loss':
        // listening|finalizing → buffering (§3 offline edge); elsewhere it just tears down.
        if (from === 'listening' || from === 'finalizing') return this.go('buffering');
        return { kind: 'ignored' };
    }
  }

  /** any → error(code). Always legal (§3). */
  toError(): SessionState {
    this.current = 'error';
    return this.current;
  }

  /** error → idle after the HUD displays; also used to restore a resumed connection. */
  reset(to: SessionState = 'idle'): void {
    this.current = to;
  }

  private go(to: SessionState): TransitionOutcome {
    this.current = to;
    return { kind: 'ok', state: to };
  }
}
