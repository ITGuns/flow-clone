// Injects the settings stylesheet once. Mirrors the permission surfaces' approach (a <style> element
// rather than a build-time CSS pipeline). Idempotent by id so mounting multiple settings views does
// not duplicate the rules.
import type { ReactElement } from 'react';
import { SETTINGS_CSS, SETTINGS_STYLE_ID } from './settings-styles';

export function SettingsStyles(): ReactElement {
  return <style id={SETTINGS_STYLE_ID}>{SETTINGS_CSS}</style>;
}
