// Container that binds a `PermissionFlow` (state machine) to the presentational surfaces (Phase 2d).
// It subscribes to the flow, renders the right surface for the current state, and wires the button
// callbacks back to the flow. This is the seam the onboarding flow (task 4d) plugs into. The
// pre-prompt-before-OS-request invariant lives in the machine, not here: this view can only ever
// call `flow.acknowledge()` from the `explaining` surface's primary button.
import { useEffect, useState, type ReactElement } from 'react';
import type { PermissionFlow, PermissionFlowSnapshot } from '../../permissions';
import { PermissionPrePrompt } from './PermissionPrePrompt';
import { PermissionDeniedRecovery } from './PermissionDeniedRecovery';
import { PERMISSION_CSS, PERMISSION_STYLE_ID } from './permission-styles';
import type { Platform } from './permission-copy';

export interface PermissionFlowViewProps {
  flow: PermissionFlow;
  platform: Platform;
  /** Optional "not now" affordance on the pre-prompt. */
  onDismiss?: () => void;
}

/** Emits the shared stylesheet once. Rendered at the top of the view so surfaces are styleable
 *  without a build-time CSS pipeline (see permission-styles.ts). */
function PermissionStyles(): ReactElement {
  return <style id={PERMISSION_STYLE_ID}>{PERMISSION_CSS}</style>;
}

/** Subscribe a component to a flow's snapshot. Re-syncs on subscribe to avoid missing a change
 *  that landed between the initial render and the effect. */
function useFlowSnapshot(flow: PermissionFlow): PermissionFlowSnapshot {
  const [snap, setSnap] = useState<PermissionFlowSnapshot>(() => flow.snapshot());
  useEffect(() => {
    const unsubscribe = flow.subscribe(setSnap);
    setSnap(flow.snapshot());
    return unsubscribe;
  }, [flow]);
  return snap;
}

export function PermissionFlowView({
  flow,
  platform,
  onDismiss,
}: PermissionFlowViewProps): ReactElement | null {
  const snap = useFlowSnapshot(flow);

  const body = ((): ReactElement | null => {
    switch (snap.state) {
      case 'explaining':
        return (
          <PermissionPrePrompt
            kind={snap.kind}
            onAcknowledge={() => void flow.acknowledge()}
            {...(onDismiss ? { onDismiss } : {})}
          />
        );
      case 'requesting':
        // The OS prompt is up (microphone). Keep the explanation visible but busy.
        return <PermissionPrePrompt kind={snap.kind} onAcknowledge={() => {}} busy />;
      case 'recovery':
        return (
          <PermissionDeniedRecovery
            kind={snap.kind}
            platform={platform}
            reason={snap.reason ?? 'denied'}
            onRecheck={() => void flow.recheck()}
            onOpenSettings={() => void flow.openSettings()}
          />
        );
      case 'granted':
        return (
          <section className="utp-card" role="status">
            <p className="utp-status-ok">
              {snap.kind === 'microphone' ? 'Microphone access granted.' : 'Accessibility enabled.'}
            </p>
          </section>
        );
      case 'not-required':
      case 'idle':
        return null;
    }
  })();

  if (body === null) return null;
  return (
    <div className="utp-root">
      <PermissionStyles />
      {body}
    </div>
  );
}
