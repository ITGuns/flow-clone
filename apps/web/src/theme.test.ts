import { describe, it, expect } from 'vitest';
import { nextTheme, parsePreference, resolveTheme } from './theme';

describe('theme', () => {
  it('parses stored preferences, defaulting unknowns to system', () => {
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference('purple')).toBe('system');
  });

  it('resolves system to the OS signal, explicit choices verbatim', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('toggles between light and dark', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});
