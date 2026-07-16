// Desktop settings shape + defaults — shared by the main process (persistence, `main/settings-store.ts`)
// and the renderer (the Settings UI under `renderer/settings/**`). This is DESKTOP-LOCAL config, not a
// CONTRACTS.md protocol type, so the channel names and shape below are this task's own domain (4c) —
// they deliberately do NOT touch the frozen HUD IPC contract (`ipc-contract.ts`). A `version` field
// exists so a future shape change can migrate old on-disk files instead of discarding them.

/**
 * On-disk settings version. Bump when the persisted shape changes in a way that needs migration;
 * `migrateSettings` maps any older/unknown blob forward to the current `Settings`.
 */
export const SETTINGS_VERSION = 1 as const;

/**
 * Default push-to-talk hotkey — an Electron accelerator string (CONTRACTS.md §2.3 `HotkeyManager`).
 *
 * Chosen `F8` because it is the safest cross-OS *held* key for push-to-talk:
 *  - A single non-modifier key can be held down for the whole utterance; a bare modifier (RightAlt /
 *    RightControl) reads nicer but is unreliable — RightAlt is AltGr on many international Windows
 *    layouts and RightControl is absent from some compact keyboards.
 *  - F8 sits away from the macOS media-key cluster (F7/F9–F12 are prev/next/mute/volume) so it is far
 *    less likely to be swallowed by the OS than a low F-key, and it is rarely bound by apps.
 *  - Both accelerator parsers already resolve it (`native/win32/accelerator.ts`, `native/darwin/…`).
 * The user can rebind it in Settings; validation runs through the native `HotkeyManager.isSupported`.
 */
export const DEFAULT_HOTKEY = 'F8';

export interface Settings {
  /** Schema version of the persisted blob; always written as `SETTINGS_VERSION`. */
  version: number;
  /** Push-to-talk hotkey as an Electron accelerator string (e.g. "F8", "Alt+Space"). */
  hotkey: string;
  /**
   * Anonymous usage telemetry (self-hosted PostHog). Default TRUE — guide §1 "anonymous by default,
   * opt-out in settings". Counts and latency timings only, NEVER transcript content (guide §3).
   */
  telemetryEnabled: boolean;
  /**
   * Launch Undertone at OS login. Stored in v1 only; the actual OS registration is wired in the
   * install/updater phase (Phase 5). Default false.
   */
  launchAtLogin: boolean;
  /** UI + formatting locale, BCP-47. Read-only in v1 (CONTRACTS.md §1 FormatRequest.locale). */
  locale: string;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  hotkey: DEFAULT_HOTKEY,
  telemetryEnabled: true,
  launchAtLogin: false,
  locale: 'en-US',
};

/** A partial update applied over the current settings via the store / bridge `set`. */
export type SettingsPatch = Partial<Omit<Settings, 'version'>>;

/**
 * Coerce an arbitrary parsed blob into a valid `Settings`, field-by-field: any missing or
 * wrong-typed field falls back to its default. This is what makes a partially-written or
 * schema-drifted (but still JSON-parseable) file recover to sane values instead of crashing.
 * `version` is always stamped to the current version.
 */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    version: SETTINGS_VERSION,
    hotkey:
      typeof r.hotkey === 'string' && r.hotkey.trim() !== '' ? r.hotkey : DEFAULT_SETTINGS.hotkey,
    telemetryEnabled:
      typeof r.telemetryEnabled === 'boolean'
        ? r.telemetryEnabled
        : DEFAULT_SETTINGS.telemetryEnabled,
    launchAtLogin:
      typeof r.launchAtLogin === 'boolean' ? r.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin,
    locale:
      typeof r.locale === 'string' && r.locale.trim() !== '' ? r.locale : DEFAULT_SETTINGS.locale,
  };
}

/**
 * Migrate a parsed on-disk blob forward to the current `Settings`. v1 has no prior versions, so this
 * is `normalizeSettings`; the seam exists so a future `version` bump adds a branch here without
 * touching callers.
 */
export function migrateSettings(raw: unknown): Settings {
  return normalizeSettings(raw);
}

/**
 * Apply a patch over a base `Settings`, then re-normalize so an out-of-band bad value can never be
 * written. `version` is not patchable.
 */
export function applyPatch(base: Settings, patch: SettingsPatch): Settings {
  return normalizeSettings({ ...base, ...patch, version: SETTINGS_VERSION });
}

/**
 * Renderer↔main IPC channels for settings (4c-owned; distinct from the frozen HUD channels in
 * `ipc-contract.ts`). The real `ipcMain`/`ipcRenderer` wiring lands at the Phase 4 gate; the
 * renderer talks to a `SettingsBridge` port (fake in tests, IPC-backed in production) so nothing
 * in the UI imports Electron.
 */
export const SETTINGS_CHANNELS = {
  /** renderer → main (invoke): read current settings. */
  get: 'undertone:settings:get',
  /** renderer → main (invoke): apply a `SettingsPatch`, returns the new settings. */
  set: 'undertone:settings:set',
  /** main → renderer (send): full-settings push whenever the store changes. */
  changed: 'undertone:settings:changed',
} as const;
