import './styles.css';
import { parsePreference, resolveTheme, nextTheme, THEME_STORAGE_KEY, type Theme } from './theme';
import { initAnimations } from './anim';

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------
// The <head> inline snippet has already stamped `data-theme` before first paint (no flash).
// Here we only handle the toggle button and keep the OS listener live for `system` users.

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private-mode / disabled storage: theme still works for the session, just not persisted.
  }
}

function initThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  // Reflect the resolved theme onto the toggle for assistive tech.
  const syncButtonLabel = (): void => {
    if (!button) return;
    const isDark = currentTheme() === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  syncButtonLabel();

  button?.addEventListener('click', () => {
    const target = nextTheme(currentTheme());
    applyTheme(target);
    writeStorage(THEME_STORAGE_KEY, target);
    syncButtonLabel();
  });

  // Only follow the OS while the user hasn't made an explicit choice.
  media.addEventListener('change', (event) => {
    if (parsePreference(readStorage(THEME_STORAGE_KEY)) !== 'system') return;
    applyTheme(resolveTheme('system', event.matches));
    syncButtonLabel();
  });
}

// ---------------------------------------------------------------------------
// Mobile navigation
// ---------------------------------------------------------------------------

function initMobileNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-nav-menu]');
  if (!toggle || !menu) return;

  const setOpen = (open: boolean): void => {
    toggle.setAttribute('aria-expanded', String(open));
    menu.dataset.open = String(open);
  };
  setOpen(false);

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // Collapse the menu after navigating so the next page starts clean.
  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  // Escape closes the menu and returns focus to the trigger.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Pricing billing period toggle (pricing page only; no-op elsewhere)
// ---------------------------------------------------------------------------

function initBillingToggle(): void {
  const controls = document.querySelectorAll<HTMLButtonElement>('[data-billing]');
  if (controls.length === 0) return;
  const priceRoot = document.querySelector<HTMLElement>('[data-price-period]');
  if (!priceRoot) return;

  const select = (period: 'monthly' | 'yearly'): void => {
    priceRoot.dataset.pricePeriod = period;
    controls.forEach((control) => {
      const active = control.dataset.billing === period;
      control.setAttribute('aria-pressed', String(active));
    });
  };

  controls.forEach((control) => {
    control.addEventListener('click', () => {
      const period = control.dataset.billing === 'yearly' ? 'yearly' : 'monthly';
      select(period);
    });
  });
}

function boot(): void {
  initThemeToggle();
  initMobileNav();
  initBillingToggle();
  initAnimations();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
