// Onboarding permission sequencer (Phase 2d). Drives the per-kind `PermissionFlow`s in a fixed
// order — MICROPHONE FIRST, then accessibility — and computes an overall readiness result that the
// onboarding flow (task 4d) consumes. Kinds that resolve without user interaction (already granted,
// or `not-required` — e.g. accessibility on Windows) are skipped automatically, so the active flow
// is always the next one that actually needs the user. It never triggers an OS prompt on its own:
// prompts happen only through `acknowledgeActive()`, which delegates to the active flow's
// `acknowledge()` (which itself enforces the pre-prompt-first invariant).
import type { PermissionBridge, PermissionKind } from './bridge';
import { PermissionFlow, type PermissionFlowState } from './machine';

/** Fixed onboarding order. Microphone gates everything (no dictation without it); accessibility
 *  (macOS injection) comes second and is `not-required` on Windows. */
const ORDER: readonly PermissionKind[] = ['microphone', 'accessibility'] as const;

export interface OnboardingReadiness {
  /** All required permissions satisfied (granted, or not-required on this platform). */
  ready: boolean;
  /** Terminal-or-current state of each kind, for the onboarding UI and telemetry. */
  states: Record<PermissionKind, PermissionFlowState>;
}

export type OnboardingListener = () => void;

export class OnboardingPermissions {
  private readonly flows: Record<PermissionKind, PermissionFlow>;
  private index = 0;
  private readonly listeners = new Set<OnboardingListener>();

  constructor(bridge: PermissionBridge) {
    this.flows = {
      microphone: new PermissionFlow('microphone', bridge),
      accessibility: new PermissionFlow('accessibility', bridge),
    };
    // Re-broadcast every underlying flow change to onboarding subscribers.
    for (const kind of ORDER) this.flows[kind].subscribe(() => this.emit());
  }

  // ── Observation ──────────────────────────────────────────────────────────────────────────
  /** The flow currently awaiting the user, or undefined once onboarding is complete. */
  get activeFlow(): PermissionFlow | undefined {
    const kind = ORDER[this.index];
    return kind ? this.flows[kind] : undefined;
  }
  get activeKind(): PermissionKind | undefined {
    return this.activeFlow?.kind;
  }
  get isComplete(): boolean {
    return this.index >= ORDER.length;
  }
  flowFor(kind: PermissionKind): PermissionFlow {
    return this.flows[kind];
  }

  get readiness(): OnboardingReadiness {
    const states = {} as Record<PermissionKind, PermissionFlowState>;
    let ready = true;
    for (const kind of ORDER) {
      const flow = this.flows[kind];
      states[kind] = flow.state;
      if (!flow.isSatisfied) ready = false;
    }
    return { ready, states };
  }

  subscribe(listener: OnboardingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Driving the sequence ─────────────────────────────────────────────────────────────────

  /** Begin onboarding: start the first flow and skip past any that resolve without the user. */
  async start(): Promise<void> {
    await this.flows[ORDER[this.index]!].start();
    await this.advancePastSatisfied();
  }

  /** Delegate to the active flow's acknowledge (the only OS-prompt trigger), then advance. */
  async acknowledgeActive(): Promise<void> {
    const flow = this.activeFlow;
    if (!flow) return;
    await flow.acknowledge();
    await this.advancePastSatisfied();
  }

  /** Delegate to the active flow's re-check (post-Settings), then advance if it resolved. */
  async recheckActive(): Promise<void> {
    const flow = this.activeFlow;
    if (!flow) return;
    await flow.recheck();
    await this.advancePastSatisfied();
  }

  /** Deep-link Settings for the active flow's kind. */
  async openSettingsActive(): Promise<void> {
    await this.activeFlow?.openSettings();
  }

  /**
   * Advance the cursor past every flow that is already satisfied, starting each newly-active flow
   * (which may itself resolve immediately — e.g. Windows accessibility → not-required). Stops at
   * the first flow that needs the user (`explaining`/`recovery`) or when all kinds are done.
   */
  private async advancePastSatisfied(): Promise<void> {
    while (this.index < ORDER.length) {
      const flow = this.flows[ORDER[this.index]!];
      if (flow.state === 'idle') await flow.start();
      if (flow.isSatisfied) {
        this.index += 1;
        continue;
      }
      break; // explaining or recovery — hand control back to the user
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
