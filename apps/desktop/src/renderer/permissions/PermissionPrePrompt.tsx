// The in-app explanation shown BEFORE any OS permission interaction (guide §3, non-negotiable).
// Purely presentational: it renders the "why / what we do / what we don't do" copy and, only when
// the user presses the primary button, calls `onAcknowledge` — which is the single caller that lets
// the state machine trigger the OS prompt (microphone) or deep-link to Settings (accessibility).
import { useId, type ReactElement } from 'react';
import type { PermissionKind } from '../../permissions';
import { prePromptCopy } from './permission-copy';

export interface PermissionPrePromptProps {
  kind: PermissionKind;
  /** Fired on the explicit primary action — the ONLY thing that advances to the OS interaction. */
  onAcknowledge: () => void;
  /** Optional "not now" affordance. When omitted, no dismiss button renders. */
  onDismiss?: () => void;
  /** True while the OS interaction is in flight; disables the buttons and shows a spinner. */
  busy?: boolean;
}

export function PermissionPrePrompt({
  kind,
  onAcknowledge,
  onDismiss,
  busy = false,
}: PermissionPrePromptProps): ReactElement {
  const copy = prePromptCopy(kind);
  const titleId = useId();
  const whyId = useId();

  return (
    <section
      className="utp-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={whyId}
    >
      <h2 id={titleId} className="utp-title">
        {copy.title}
      </h2>
      <p id={whyId} className="utp-why">
        {copy.why}
      </p>

      <p className="utp-legend">What Undertone does</p>
      <ul className="utp-list">
        {copy.does.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <p className="utp-legend">What it never does</p>
      <ul className="utp-list">
        {copy.doesNot.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="utp-actions">
        <button
          type="button"
          className="utp-btn utp-btn-primary"
          onClick={onAcknowledge}
          disabled={busy}
          // Focus starts on the primary action for keyboard users.
          autoFocus
        >
          {busy ? <span className="utp-spinner" aria-hidden="true" /> : null}
          {copy.acknowledgeLabel}
        </button>
        {onDismiss ? (
          <button type="button" className="utp-btn" onClick={onDismiss} disabled={busy}>
            {copy.dismissLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
