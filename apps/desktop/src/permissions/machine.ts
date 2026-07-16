// Per-kind permission flow state machine (Phase 2d). One `PermissionFlow` drives one permission
// (microphone or accessibility) through:
//
//   idle → explaining → requesting → granted
//                    ↘            ↘ recovery ⇄ (recheck) → granted
//   idle → granted | not-required | recovery         (resolved straight from the initial check)
//
// THE NON-NEGOTIABLE INVARIANT (guide §3): the OS permission prompt is triggered ONLY from
// `acknowledge()`, i.e. only after the user has seen and accepted the in-app explanation while in
// the `explaining` state. `start()` performs a pure status *check* and never requests. Any attempt
// to `acknowledge()` from a non-`explaining` state is a no-op that does NOT touch the bridge. The
// unit tests assert `bridge.requestMicrophone` call-count stays 0 until an explicit acknowledge.
import type { PermissionBridge, PermissionKind, PermissionStatus } from './bridge';

/**
 * Resting states of the flow. `explaining` shows the pre-prompt; `requesting` is the brief window
 * while the OS prompt is up; `recovery` carries OS-specific guidance after a refusal/restriction.
 * `granted` and `not-required` are the two "satisfied" terminals.
 */
export type PermissionFlowState =
  'idle' | 'explaining' | 'requesting' | 'granted' | 'recovery' | 'not-required';

/** Why the flow is in `recovery`, so the UI can tailor its guidance. */
export type RecoveryReason = 'denied' | 'restricted';

export interface PermissionFlowSnapshot {
  kind: PermissionKind;
  state: PermissionFlowState;
  /** Set iff `state === 'recovery'`. */
  reason?: RecoveryReason;
  /** The most recent raw status observed from the bridge (for telemetry/debug; never PII). */
  lastStatus?: PermissionStatus;
}

export type FlowListener = (snapshot: PermissionFlowSnapshot) => void;

export class PermissionFlow {
  private _state: PermissionFlowState = 'idle';
  private _reason: RecoveryReason | undefined;
  private _lastStatus: PermissionStatus | undefined;
  private explained = false; // true once the pre-prompt has been shown (drives accessibility routing)
  private readonly listeners = new Set<FlowListener>();

  constructor(
    readonly kind: PermissionKind,
    private readonly bridge: PermissionBridge,
  ) {}

  // ── Observation ──────────────────────────────────────────────────────────────────────────
  get state(): PermissionFlowState {
    return this._state;
  }
  get reason(): RecoveryReason | undefined {
    return this._reason;
  }
  get lastStatus(): PermissionStatus | undefined {
    return this._lastStatus;
  }
  /** True once the permission is satisfied and no further action is possible or needed. */
  get isSatisfied(): boolean {
    return this._state === 'granted' || this._state === 'not-required';
  }
  /** True in a terminal state (satisfied or a resting recovery that only the user can clear). */
  get isTerminal(): boolean {
    return this.isSatisfied || this._state === 'recovery';
  }

  snapshot(): PermissionFlowSnapshot {
    return {
      kind: this.kind,
      state: this._state,
      ...(this._reason !== undefined ? { reason: this._reason } : {}),
      ...(this._lastStatus !== undefined ? { lastStatus: this._lastStatus } : {}),
    };
  }

  subscribe(listener: FlowListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Transitions ────────────────────────────────────────────────────────────────────────────

  /**
   * Enter the flow. Performs a pure status *check* (never an OS request) and routes:
   *   granted → granted · not-required → not-required · restricted → recovery(restricted)
   *   denied → recovery(denied)  (macOS won't re-prompt once denied; go straight to settings guidance)
   *   undetermined → explaining  (show the in-app pre-prompt; the OS request waits for acknowledge)
   */
  async start(): Promise<void> {
    const status = await this.check();
    this.routeFromStatus(status, { allowExplain: true });
  }

  /**
   * The user accepted the in-app explanation. This — and only this — triggers the OS interaction.
   * No-op (and NO bridge call) unless we are in `explaining`, which guarantees the pre-prompt was
   * shown first (guide §3).
   *
   * - microphone: fire the native OS permission prompt, then resolve to granted/recovery.
   * - accessibility: macOS has no programmatic prompt — the acknowledged action is deep-linking to
   *   System Settings; the flow then rests in `recovery` awaiting the user's toggle + a re-check.
   */
  async acknowledge(): Promise<void> {
    if (this._state !== 'explaining') return;
    if (this.kind === 'microphone') {
      this.set('requesting');
      const status = await this.bridge.requestMicrophone();
      this._lastStatus = status;
      // A request never lands back on `explaining`; resolve to a terminal outcome.
      this.routeFromStatus(status, { allowExplain: false });
    } else {
      await this.bridge.openAccessibilitySettings();
      this.set('recovery', 'denied');
    }
  }

  /**
   * Re-query the OS after the user visited Settings (or on demand). Available from `recovery` and
   * from any satisfied/idle state. Re-checks and re-routes; a now-`granted` permission resolves.
   */
  async recheck(): Promise<void> {
    const status = await this.check();
    // On a re-check, an `undetermined` result means the prior grant/denial was reset — offer the
    // pre-prompt again rather than silently requesting.
    this.routeFromStatus(status, { allowExplain: true });
  }

  /** Deep-link OS Settings for this kind. Recovery affordance; leaves flow state unchanged. */
  async openSettings(): Promise<void> {
    if (this.kind === 'microphone') {
      await this.bridge.openMicrophoneSettings();
    } else {
      await this.bridge.openAccessibilitySettings();
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────

  private async check(): Promise<PermissionStatus> {
    const status =
      this.kind === 'microphone'
        ? await this.bridge.checkMicrophone()
        : await this.bridge.checkAccessibility();
    this._lastStatus = status;
    return status;
  }

  private routeFromStatus(status: PermissionStatus, opts: { allowExplain: boolean }): void {
    switch (status) {
      case 'granted':
        this.set('granted');
        return;
      case 'not-required':
        this.set('not-required');
        return;
      case 'restricted':
        this.set('recovery', 'restricted');
        return;
      case 'denied':
        // Microphone: the OS won't re-prompt once denied, so go straight to Settings guidance.
        // Accessibility: there's no prompt at all — explain first (if we haven't), then guide.
        if (this.kind === 'accessibility' && opts.allowExplain && !this.explained) {
          this.set('explaining');
        } else {
          this.set('recovery', 'denied');
        }
        return;
      case 'undetermined':
        // Undetermined can only be resolved by an OS interaction, which requires the pre-prompt
        // first. After a *request* (allowExplain=false) an undetermined result is a refusal.
        if (opts.allowExplain) this.set('explaining');
        else this.set('recovery', 'denied');
        return;
    }
  }

  private set(next: PermissionFlowState, reason?: RecoveryReason): void {
    if (next === 'explaining') this.explained = true;
    this._reason = next === 'recovery' ? reason : undefined;
    // Emit even on a same-state re-entry into recovery when the reason changed; otherwise dedupe.
    if (this._state === next && this._reason === reason) {
      if (next !== 'recovery') return;
    }
    this._state = next;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }
}
