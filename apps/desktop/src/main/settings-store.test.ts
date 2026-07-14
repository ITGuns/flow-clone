import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from './settings-store';
import { DEFAULT_SETTINGS, DEFAULT_HOTKEY, type SettingsFs } from './settings-store';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'undertone-settings-'));
  file = join(dir, 'settings.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore — load', () => {
  it('returns defaults when the file is missing, without writing anything', () => {
    const store = new SettingsStore({ filePath: file });
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(file)).toBe(false); // missing file is not an error and is not created
  });

  it('loads a previously-saved file round-trip', () => {
    const a = new SettingsStore({ filePath: file });
    a.load();
    a.set({ hotkey: 'Alt+Space', telemetryEnabled: false });

    const b = new SettingsStore({ filePath: file });
    const loaded = b.load();
    expect(loaded.hotkey).toBe('Alt+Space');
    expect(loaded.telemetryEnabled).toBe(false);
  });

  it('coerces a partial / drifted (but valid JSON) file to defaults per-field', () => {
    writeFileSync(file, JSON.stringify({ hotkey: 42, telemetryEnabled: 'yes', foo: 'bar' }), 'utf8');
    const store = new SettingsStore({ filePath: file });
    const s = store.load();
    expect(s.hotkey).toBe(DEFAULT_HOTKEY); // wrong type → default
    expect(s.telemetryEnabled).toBe(true); // wrong type → default (telemetry stays on)
    expect(s.locale).toBe('en-US');
  });

  it('on a corrupt (unparseable) file: preserves a .bak and recovers to defaults, never throws', () => {
    writeFileSync(file, '{ this is not json ', 'utf8');
    const store = new SettingsStore({ filePath: file });
    let loaded: unknown;
    expect(() => {
      loaded = store.load();
    }).not.toThrow();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('{ this is not json '); // original preserved
    // The main file is replaced with valid defaults, so a subsequent load does not re-bak.
    const reparsed = JSON.parse(readFileSync(file, 'utf8')) as { hotkey: string };
    expect(reparsed.hotkey).toBe(DEFAULT_HOTKEY);
  });
});

describe('SettingsStore — get / set', () => {
  it('typed get returns the whole object and single keys', () => {
    const store = new SettingsStore({ filePath: file });
    store.load();
    expect(store.get().locale).toBe('en-US');
    expect(store.get('hotkey')).toBe(DEFAULT_HOTKEY);
    expect(store.get('telemetryEnabled')).toBe(true);
  });

  it('set merges a patch, persists it, and re-normalizes bad values', () => {
    const store = new SettingsStore({ filePath: file });
    store.load();
    const next = store.set({ hotkey: 'F9', launchAtLogin: true });
    expect(next.hotkey).toBe('F9');
    expect(next.launchAtLogin).toBe(true);
    // Empty hotkey is invalid → coerced back to default rather than persisted blank.
    const coerced = store.set({ hotkey: '   ' });
    expect(coerced.hotkey).toBe(DEFAULT_HOTKEY);

    const reloaded = new SettingsStore({ filePath: file }).load();
    expect(reloaded.launchAtLogin).toBe(true);
    expect(reloaded.hotkey).toBe(DEFAULT_HOTKEY);
  });

  it('get() before load() still returns defaults (no crash)', () => {
    const store = new SettingsStore({ filePath: file });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SettingsStore — atomic save', () => {
  it('writes via a temp file then rename (never a partial main file)', () => {
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    const realFs: SettingsFs = {
      existsSync,
      readFileSync: (p) => readFileSync(p, 'utf8'),
      writeFileSync: (p, data) => {
        writes.push(p);
        writeFileSync(p, data, 'utf8');
      },
      renameSync: (from, to) => {
        renames.push([from, to]);
        // emulate node rename
        writeFileSync(to, readFileSync(from, 'utf8'), 'utf8');
        rmSync(from, { force: true });
      },
      mkdirSync: () => undefined,
      copyFileSync: (from, to) => writeFileSync(to, readFileSync(from, 'utf8'), 'utf8'),
    };
    const store = new SettingsStore({ filePath: file, fs: realFs });
    store.load();
    store.set({ hotkey: 'F7' });
    // The write target was the temp path; the visible file arrived via rename.
    expect(writes.some((p) => p.endsWith('.tmp'))).toBe(true);
    expect(renames.some(([, to]) => to === file)).toBe(true);
  });

  it('creates the parent directory on save', () => {
    const nested = join(dir, 'nested', 'deep', 'settings.json');
    const store = new SettingsStore({ filePath: nested });
    store.load();
    store.set({ locale: 'en-US' });
    expect(existsSync(nested)).toBe(true);
  });
});

describe('SettingsStore — change listener', () => {
  it('notifies subscribers with the new settings on set, and stops after unsubscribe', () => {
    const store = new SettingsStore({ filePath: file });
    store.load();
    const seen: string[] = [];
    const unsub = store.subscribe((s) => seen.push(s.hotkey));
    store.set({ hotkey: 'F5' });
    store.set({ hotkey: 'F6' });
    expect(seen).toEqual(['F5', 'F6']);
    unsub();
    store.set({ hotkey: 'F7' });
    expect(seen).toEqual(['F5', 'F6']); // no further notifications
  });

  it('does not let one throwing listener block the others', () => {
    const store = new SettingsStore({ filePath: file });
    store.load();
    const good = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(good);
    expect(() => store.set({ hotkey: 'F4' })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
