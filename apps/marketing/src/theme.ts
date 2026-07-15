// Theme resolution kept as pure functions so it is unit-testable without a DOM. The wiring that
// touches `document`/`localStorage` lives in main.ts (and the no-flash inline snippet in each
// page's <head>); everything with a decision in it is here.

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

/** localStorage key holding the user's explicit choice (absent = follow the OS). */
export const THEME_STORAGE_KEY = 'undertone-theme';

/** Coerce arbitrary stored/serialised input into a valid preference. */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** Resolve the concrete theme to paint, given the preference and the OS dark-mode signal. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): Theme {
  if (pref === 'light' || pref === 'dark') return pref;
  return prefersDark ? 'dark' : 'light';
}

/** The theme a toggle press should move to from the currently-applied theme. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}
