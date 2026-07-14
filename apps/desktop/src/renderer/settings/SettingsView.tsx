// Top-level Settings surface (task 4c). Loads settings from the injected `SettingsBridge`, subscribes
// to out-of-band changes, and composes the three sections: hotkey recorder, dictionary manager,
// preferences. Every side-effect goes through an injected port (bridge, dictionary api, isSupported)
// so the whole screen renders and tests in jsdom with fakes — no Electron, no network.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Settings, SettingsPatch } from '../../settings-schema';
import type { SettingsBridge } from './settings-bridge';
import type { DictionaryApi } from './dictionary-api';
import { SettingsStyles } from './SettingsStyles';
import { HotkeyRecorder } from './HotkeyRecorder';
import { DictionaryManager } from './DictionaryManager';
import { PreferencesPanel } from './PreferencesPanel';

export interface SettingsViewProps {
  bridge: SettingsBridge;
  dictionaryApi: DictionaryApi;
  /** Native `HotkeyManager.isSupported`, injected at the Phase 4 gate. */
  isHotkeySupported: (accelerator: string) => boolean;
}

export function SettingsView({
  bridge,
  dictionaryApi,
  isHotkeySupported,
}: SettingsViewProps): ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    void bridge.get().then((s) => {
      if (active) setSettings(s);
    });
    const unsubscribe = bridge.subscribe((s) => {
      if (active) setSettings(s);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const patch = useCallback(
    (p: SettingsPatch) => {
      void bridge.set(p);
    },
    [bridge],
  );

  return (
    <div className="uts-root">
      <SettingsStyles />
      {settings === null ? (
        <p className="uts-empty" aria-live="polite">
          Loading settings…
        </p>
      ) : (
        <>
          <section className="uts-section" aria-label="Shortcut">
            <h3 className="uts-section-title">Shortcut</h3>
            <HotkeyRecorder
              value={settings.hotkey}
              onChange={(hotkey) => patch({ hotkey })}
              isSupported={isHotkeySupported}
            />
          </section>
          <DictionaryManager api={dictionaryApi} />
          <PreferencesPanel settings={settings} onChange={patch} />
        </>
      )}
    </div>
  );
}
