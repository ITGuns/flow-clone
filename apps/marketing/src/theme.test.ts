import { describe, it, expect } from 'vitest';
import { parsePreference, resolveTheme, nextTheme } from './theme';

describe('parsePreference', () => {
  it('passes through explicit valid choices', () => {
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('dark')).toBe('dark');
  });

  it('falls back to "system" for anything unrecognised', () => {
    // Failure paths: missing, empty, garbage, and the literal "system" all collapse to system.
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference(undefined)).toBe('system');
    expect(parsePreference('')).toBe('system');
    expect(parsePreference('SYSTEM')).toBe('system');
    expect(parsePreference('purple')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('honours an explicit preference regardless of the OS signal', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS signal when the preference is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('nextTheme', () => {
  it('toggles between the two concrete themes', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });

  it('is its own inverse', () => {
    expect(nextTheme(nextTheme('light'))).toBe('light');
    expect(nextTheme(nextTheme('dark'))).toBe('dark');
  });
});
