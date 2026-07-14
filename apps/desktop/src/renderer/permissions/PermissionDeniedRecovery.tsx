// Recovery surface shown when a permission is denied or restricted (Phase 2d). Presentational: it
// renders OS-specific, numbered guidance plus two affordances — a Settings deep-link and a
// "Re-check" action — whose handlers the container wires to `flow.openSettings()` / `flow.recheck()`.
// For a `restricted` (policy/MDM) permission the user cannot self-serve, so the Settings deep-link
// is suppressed and only a re-check remains.
import { useId, type ReactElement } from 'react';
import type { PermissionKind, RecoveryReason } from '../../permissions';
import { recoveryCopy, type Platform } from './permission-copy';

export interface PermissionDeniedRecoveryProps {
  kind: PermissionKind;
  platform: Platform;
  reason: RecoveryReason;
  /** Re-query the OS status (after the user changed a Setting). */
  onRecheck: () => void;
  /** Deep-link the relevant OS Settings pane. */
  onOpenSettings: () => void;
  /** True while a re-check/open is in flight. */
  busy?: boolean;
}

export function PermissionDeniedRecovery({
  kind,
  platform,
  reason,
  onRecheck,
  onOpenSettings,
  busy = false,
}: PermissionDeniedRecoveryProps): ReactElement {
  const restricted = reason === 'restricted';
  const copy = recoveryCopy(kind, platform, restricted);
  const titleId = useId();
  const leadId = useId();

  return (
    <section
      className="utp-card"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={leadId}
    >
      <h2 id={titleId} className="utp-title utp-status-danger">
        {copy.title}
      </h2>
      <p id={leadId} className="utp-lead">
        {copy.lead}
      </p>

      <ol className="utp-steps">
        {copy.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="utp-actions">
        {/* Restricted permissions can't be changed by the user, so no Settings deep-link. */}
        {restricted ? null : (
          <button
            type="button"
            className="utp-btn utp-btn-primary"
            onClick={onOpenSettings}
            disabled={busy}
          >
            {copy.openSettingsLabel}
          </button>
        )}
        <button type="button" className="utp-btn" onClick={onRecheck} disabled={busy} autoFocus>
          {busy ? <span className="utp-spinner" aria-hidden="true" /> : null}
          {copy.recheckLabel}
        </button>
      </div>
    </section>
  );
}
