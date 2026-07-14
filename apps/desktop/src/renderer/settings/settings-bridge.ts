// The renderer↔main port for settings (task 4c). The Settings UI depends ONLY on this interface,
// never on Electron, so it renders and unit-tests in jsdom against `FakeSettingsBridge`. The real
// implementation (Phase 4 gate) forwards `get`/`set` over `SETTINGS_CHANNELS.get`/`.set` (invoke)
// and `subscribe` off `SETTINGS_CHANNELS.changed` (main→renderer push) — see settings-schema.ts.
import type { Settings, SettingsPatch } from '../../settings-schema';

export interface SettingsBridge {
  /** Read the current settings. */
  get(): Promise<Settings>;
  /** Apply a patch; resolves with the new settings after persistence. */
  set(patch: SettingsPatch): Promise<Settings>;
  /** Subscribe to settings pushed from main (e.g. changed in another window). Returns unsubscribe. */
  subscribe(listener: (settings: Settings) => void): () => void;
}
