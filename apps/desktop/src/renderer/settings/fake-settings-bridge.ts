// In-memory SettingsBridge for the Settings UI tests (task 4c). Not a `.test` file, so it is
// typechecked/linted with the sources but never run as a suite. Holds a mutable settings blob,
// records every patch, and lets a test push an out-of-band change to exercise `subscribe`.
import {
  DEFAULT_SETTINGS,
  applyPatch,
  type Settings,
  type SettingsPatch,
} from '../../settings-schema';
import type { SettingsBridge } from './settings-bridge';

export class FakeSettingsBridge implements SettingsBridge {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();
  /** Every patch passed to `set`, in order — asserted by round-trip tests. */
  readonly patches: SettingsPatch[] = [];

  constructor(initial: Partial<Settings> = {}) {
    this.current = { ...DEFAULT_SETTINGS, ...initial };
  }

  get(): Promise<Settings> {
    return Promise.resolve({ ...this.current });
  }

  set(patch: SettingsPatch): Promise<Settings> {
    this.patches.push(patch);
    this.current = applyPatch(this.current, patch);
    this.emit();
    return Promise.resolve({ ...this.current });
  }

  subscribe(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test control: simulate main pushing a changed settings blob. */
  pushChange(patch: SettingsPatch): void {
    this.current = applyPatch(this.current, patch);
    this.emit();
  }

  private emit(): void {
    const snapshot = { ...this.current };
    for (const listener of this.listeners) listener(snapshot);
  }
}
