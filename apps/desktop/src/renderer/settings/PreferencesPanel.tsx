// Preferences section (task 4c): telemetry opt-out, launch-at-login (stored now, applied at install
// phase), and read-only locale. The telemetry toggle's copy states the privacy posture plainly
// (guide §3): counts and timings only, never transcript content. Default-on is enforced by the schema
// (`DEFAULT_SETTINGS.telemetryEnabled === true`); this control only reflects and flips it.
import { useId, type ReactElement } from 'react';
import type { Settings, SettingsPatch } from '../../settings-schema';

export interface PreferencesPanelProps {
  settings: Settings;
  onChange: (patch: SettingsPatch) => void;
}

function Toggle({
  checked,
  onChange,
  labelId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelId: string;
}): ReactElement {
  return (
    <span className="uts-switch-wrap">
      <input
        type="checkbox"
        role="switch"
        className="uts-switch"
        aria-labelledby={labelId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="uts-switch-track" aria-hidden="true" />
    </span>
  );
}

export function PreferencesPanel({ settings, onChange }: PreferencesPanelProps): ReactElement {
  const telemetryLabelId = useId();
  const launchLabelId = useId();
  const titleId = useId();

  return (
    <section className="uts-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="uts-section-title">
        Preferences
      </h3>

      <div className="uts-row">
        <div className="uts-row-main">
          <p className="uts-row-label" id={telemetryLabelId}>
            Anonymous usage analytics
          </p>
          <p className="uts-row-hint">
            Counts and timings only — never what you say. Helps us find slow spots and crashes.
          </p>
        </div>
        <Toggle
          checked={settings.telemetryEnabled}
          onChange={(next) => onChange({ telemetryEnabled: next })}
          labelId={telemetryLabelId}
        />
      </div>

      <div className="uts-row">
        <div className="uts-row-main">
          <p className="uts-row-label" id={launchLabelId}>
            Launch at login
          </p>
          <p className="uts-row-hint">Takes effect after the next install update.</p>
        </div>
        <Toggle
          checked={settings.launchAtLogin}
          onChange={(next) => onChange({ launchAtLogin: next })}
          labelId={launchLabelId}
        />
      </div>

      <div className="uts-row">
        <div className="uts-row-main">
          <p className="uts-row-label">Language</p>
          <p className="uts-row-hint">More languages are coming in a later release.</p>
        </div>
        <span className="uts-readonly" aria-label="Language (read-only)">
          {settings.locale}
        </span>
      </div>
    </section>
  );
}
