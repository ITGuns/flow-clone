// Main-process settings persistence (task 4c). A tiny JSON file in the app's userData directory,
// written atomically (temp + rename) so a crash mid-write can never leave a half-written settings
// file. No `electron-store` dependency: the requirements here (one small typed blob, atomic write,
// corrupt-file recovery, a change listener) are a few dozen lines and a dep would add a transitive
// surface for no real gain — flagged in the task report per the "no deps without flagging" rule.
//
// Electron is intentionally NOT imported here: the store takes an explicit `filePath` and an
// injectable `fs`, so it unit-tests against a real tmp dir with zero Electron. The production wiring
// (Phase 4 gate) constructs it with `join(app.getPath('userData'), 'settings.json')` and forwards
// `subscribe` over the `SETTINGS_CHANNELS.changed` IPC channel.
import { dirname } from 'node:path';
import * as nodeFs from 'node:fs';
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  applyPatch,
  type Settings,
  type SettingsPatch,
} from '../settings-schema';

export { DEFAULT_SETTINGS, DEFAULT_HOTKEY } from '../settings-schema';
export type { Settings, SettingsPatch } from '../settings-schema';

/**
 * The synchronous fs surface the store needs. `node:fs` satisfies it directly; tests inject a
 * fake to observe the temp-then-rename atomic-write sequence.
 */
export interface SettingsFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  renameSync(from: string, to: string): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  copyFileSync(from: string, to: string): void;
}

const defaultFs: SettingsFs = {
  existsSync: (p) => nodeFs.existsSync(p),
  readFileSync: (p) => nodeFs.readFileSync(p, 'utf8'),
  writeFileSync: (p, data) => nodeFs.writeFileSync(p, data, 'utf8'),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  mkdirSync: (p) => {
    nodeFs.mkdirSync(p, { recursive: true });
  },
  copyFileSync: (from, to) => nodeFs.copyFileSync(from, to),
};

export interface SettingsStoreOptions {
  /** Absolute path to the settings JSON file. */
  filePath: string;
  /** Injectable fs (defaults to `node:fs`). */
  fs?: SettingsFs;
}

export type SettingsListener = (settings: Settings) => void;

export class SettingsStore {
  private readonly filePath: string;
  private readonly fs: SettingsFs;
  private current: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();

  constructor(options: SettingsStoreOptions) {
    this.filePath = options.filePath;
    this.fs = options.fs ?? defaultFs;
  }

  /**
   * Read settings from disk into memory and return them. Never throws:
   *  - missing file            → defaults (file is not created);
   *  - unparseable JSON        → the original is copied to `<file>.bak`, defaults are written back,
   *                              and defaults are returned (corrupt file preserved, app recovers);
   *  - valid JSON, wrong shape → coerced field-by-field to valid values (`migrateSettings`).
   */
  load(): Settings {
    if (!this.fs.existsSync(this.filePath)) {
      this.current = { ...DEFAULT_SETTINGS };
      return this.get();
    }

    let text: string;
    try {
      text = this.fs.readFileSync(this.filePath, 'utf8');
    } catch {
      // Unreadable for any reason → fall back to defaults rather than crash the app.
      this.current = { ...DEFAULT_SETTINGS };
      return this.get();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Corrupt file: preserve it for forensics, then recover to a clean defaults file so the next
      // load does not repeatedly re-back-up the same corruption.
      this.backup();
      this.current = { ...DEFAULT_SETTINGS };
      this.writeAtomic(this.current);
      return this.get();
    }

    this.current = migrateSettings(parsed);
    return this.get();
  }

  /** Snapshot of the whole settings object, or a single typed key. */
  get(): Settings;
  get<K extends keyof Settings>(key: K): Settings[K];
  get<K extends keyof Settings>(key?: K): Settings | Settings[K] {
    return key === undefined ? { ...this.current } : this.current[key];
  }

  /** Apply a patch, persist atomically, notify listeners, and return the new settings. */
  set(patch: SettingsPatch): Settings {
    this.current = applyPatch(this.current, patch);
    this.writeAtomic(this.current);
    this.emit();
    return this.get();
  }

  /** Persist the current in-memory settings (atomic write). */
  save(): void {
    this.writeAtomic(this.current);
  }

  /** Subscribe to post-change settings snapshots. Returns an idempotent unsubscribe. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      // A throwing subscriber must not block the others or the caller's `set`.
      try {
        listener(snapshot);
      } catch {
        // swallow: listener errors are the listener's problem, not the store's
      }
    }
  }

  private backup(): void {
    try {
      this.fs.copyFileSync(this.filePath, `${this.filePath}.bak`);
    } catch {
      // Best-effort: if we cannot write the backup we still recover to defaults below.
    }
  }

  private writeAtomic(settings: Settings): void {
    this.fs.mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    this.fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    this.fs.renameSync(tmp, this.filePath);
  }
}
