// Theme resolution as pure functions (unit-testable without a DOM). The DOM/localStorage wiring
// lives in App/main; the no-flash inline snippet is in index.html. Mirrors the marketing site's
// approach so the shared `undertone-theme` key means the same thing across both surfaces.
export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'undertone-theme';

/** Coerce arbitrary stored input into a valid preference. */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** Resolve the concrete theme to paint, given the preference and the OS dark-mode signal. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): Theme {
  if (pref === 'light' || pref === 'dark') return pref;
  return prefersDark ? 'dark' : 'light';
}

/** The theme a toggle press moves to from the currently-applied theme. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}
