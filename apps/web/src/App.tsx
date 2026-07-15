// Dashboard shell: header (brand, tab switch, usage meter, theme toggle) + the two tabs. Both tabs
// stay mounted (toggled with `hidden`) so the WS connection persists across tab switches. The api +
// dictation deps are injected so the whole shell is testable with fakes.
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { DictationDeps, UsageState } from './dictation/useDictation';
import type { MeResponse, WebApi } from './api/client';
import { DictationSurface } from './components/DictationSurface';
import { HistoryPanel } from './components/HistoryPanel';
import { UsageMeter } from './components/UsageMeter';
import { BrandMark, ThemeIcon } from './components/icons';
import { THEME_STORAGE_KEY, nextTheme, type Theme } from './theme';

export interface AppProps {
  deps: DictationDeps;
  api: WebApi;
}

type Tab = 'dictate' | 'history';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function App({ deps, api }: AppProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('dictate');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [liveUsage, setLiveUsage] = useState<UsageState | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme());

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((res) => {
        if (!cancelled) setMe(res);
      })
      .catch(() => {
        /* meter falls back to "loading" — not fatal to dictation */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const toggleTheme = useCallback((): void => {
    const target = nextTheme(currentTheme());
    document.documentElement.setAttribute('data-theme', target);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, target);
    } catch {
      /* storage blocked — theme still applies for the session */
    }
    setTheme(target);
  }, []);

  const usage = liveUsage ?? me?.usage ?? null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="wrap app-header__row">
          <a className="brand" href="/" aria-label="Undertone home">
            <BrandMark />
            Undertone
          </a>
          <div className="app-header__spacer" />
          <div className="tabs" role="tablist" aria-label="Dashboard sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'dictate'}
              onClick={() => setTab('dictate')}
            >
              Dictate
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              onClick={() => setTab('history')}
            >
              History
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            <ThemeIcon />
          </button>
        </div>
      </header>

      <main id="main">
        <div className="wrap">
          <div className="panel" style={{ marginBottom: '1.25rem' }}>
            <UsageMeter usage={usage} plan={me?.plan} />
          </div>

          <div className="tabpanel" hidden={tab !== 'dictate'}>
            <DictationSurface deps={deps} onUsage={setLiveUsage} />
          </div>
          <div className="tabpanel" hidden={tab !== 'history'}>
            <HistoryPanel api={api} />
          </div>
        </div>
      </main>
    </>
  );
}
