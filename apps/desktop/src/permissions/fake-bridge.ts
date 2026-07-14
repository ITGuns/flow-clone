// Scriptable in-memory PermissionBridge for unit tests (Phase 2d). Not a `.test` file, so it is
// typechecked/linted with the sources but never run as a suite. Lets a test set the OS-reported
// status per kind, script what a microphone *request* resolves to, simulate the user changing a
// setting (`setStatus`) or an OS re-prompt, and inspect every call the flow made — which is how the
// "no OS request before the pre-prompt is acknowledged" invariant is asserted.
import type { PermissionBridge, PermissionKind, PermissionStatus } from './bridge';

export interface FakeBridgeInit {
  /** Initial statuses. Omitted kinds default to `undetermined`, except accessibility which
   *  defaults to `not-required` when `platform === 'windows'`. */
  microphone?: PermissionStatus;
  accessibility?: PermissionStatus;
  /** Drives the accessibility default and mirrors the real per-OS bridge. Default `macos`. */
  platform?: 'macos' | 'windows';
  /** What `requestMicrophone()` resolves the microphone status to. Default `granted`
   *  (models the user accepting the OS prompt). Set to `denied` to model refusal. */
  requestResult?: PermissionStatus;
}

/** A recorded bridge call, in order — the audit trail the invariant tests read. */
export type BridgeCall =
  | 'checkMicrophone'
  | 'requestMicrophone'
  | 'checkAccessibility'
  | 'openMicrophoneSettings'
  | 'openAccessibilitySettings';

export class FakePermissionBridge implements PermissionBridge {
  private microphone: PermissionStatus;
  private accessibility: PermissionStatus;
  private readonly platform: 'macos' | 'windows';
  /** The status a microphone request transitions to (unless the current status is `denied`,
   *  in which case the OS won't re-prompt and the status is returned unchanged). */
  requestResult: PermissionStatus;

  /** Every call the flow made, in order. Read by tests; never mutated by them directly. */
  readonly calls: BridgeCall[] = [];

  constructor(init: FakeBridgeInit = {}) {
    this.platform = init.platform ?? 'macos';
    this.microphone = init.microphone ?? 'undetermined';
    this.accessibility =
      init.accessibility ?? (this.platform === 'windows' ? 'not-required' : 'undetermined');
    this.requestResult = init.requestResult ?? 'granted';
  }

  // ── PermissionBridge ─────────────────────────────────────────────────────────────────────
  checkMicrophone(): Promise<PermissionStatus> {
    this.calls.push('checkMicrophone');
    return Promise.resolve(this.microphone);
  }
  requestMicrophone(): Promise<PermissionStatus> {
    this.calls.push('requestMicrophone');
    // macOS never re-prompts once denied/restricted; only an `undetermined` mic moves on request.
    if (this.microphone === 'undetermined') this.microphone = this.requestResult;
    return Promise.resolve(this.microphone);
  }
  checkAccessibility(): Promise<PermissionStatus> {
    this.calls.push('checkAccessibility');
    return Promise.resolve(this.accessibility);
  }
  openMicrophoneSettings(): Promise<void> {
    this.calls.push('openMicrophoneSettings');
    return Promise.resolve();
  }
  openAccessibilitySettings(): Promise<void> {
    this.calls.push('openAccessibilitySettings');
    return Promise.resolve();
  }

  // ── Test controls ────────────────────────────────────────────────────────────────────────
  /** Simulate the user (or the OS) changing a status out-of-band, e.g. flipping the toggle in
   *  System Settings before pressing "Re-check". */
  setStatus(kind: PermissionKind, status: PermissionStatus): void {
    if (kind === 'microphone') this.microphone = status;
    else this.accessibility = status;
  }
  /** How many times a given method was called — convenience over filtering `calls`. */
  countOf(call: BridgeCall): number {
    return this.calls.filter((c) => c === call).length;
  }
}
