// Dashboard shell: header (brand, tab switch, usage meter, theme toggle) + the two tabs. Both tabs
// stay mounted (toggled with `hidden`) so the WS connection persists across tab switches. The api +
// dictation deps are injected so the whole shell is testable with fakes.
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { DictationDeps, UsageState } from './dictation/useDictation';
import type { MeResponse, WebApi } from './api/client';
import { DictationSurface } from './components/DictationSurface';
import { HistoryPanel } from './components/HistoryPanel';
import { UsageMeter } from './components/UsageMeter';
import { BillingSection } from './billing/BillingSection';
import { BrandMark, ThemeIcon } from './components/icons';
import { THEME_STORAGE_KEY, nextTheme, type Theme } from './theme';

export interface AppProps {
  deps: DictationDeps;
  api: WebApi;
}

type Tab = 'dictate' | 'history' | 'billing';

/** The billing section is deep-linkable at `/app/#billing` (marketing Pro CTAs point here). */
const BILLING_HASH = '#billing';

function tabFromHash(): Tab {
  if (typeof window === 'undefined') return 'dictate';
  return window.location.hash === BILLING_HASH ? 'billing' : 'dictate';
}

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function App({ deps, api }: AppProps): JSX.Element {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [liveUsage, setLiveUsage] = useState<UsageState | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme());
  const [mockMode, setMockMode] = useState(false);

  // Demo-mode banner: without ASR/formatting keys the server transcribes everyone's audio as
  // canned fixtures — say so, or working-as-built reads as broken (real speech lands with keys).
  useEffect(() => {
    let cancelled = false;
    api
      .getHealth?.()
      .then((h) => {
        if (!cancelled && h?.mock) setMockMode(true);
      })
      .catch(() => {
        /* unknown health — assume real, no banner */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Deep-link: `#billing` (from the marketing Pro CTAs or the quota upgrade hint) lands here.
  useEffect(() => {
    const onHash = (): void => {
      if (window.location.hash === BILLING_HASH) setTab('billing');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'billing'}
              onClick={() => setTab('billing')}
            >
              Billing
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
          {mockMode && (
            <div className="panel demo-note" role="note" style={{ marginBottom: '1.25rem' }}>
              <strong>Demo mode.</strong> Speech keys aren&apos;t configured yet, so releases
              return sample transcripts — not your words. The mic level, streaming, formatting,
              and history are all live. Add <code>DEEPGRAM_API_KEY</code> and{' '}
              <code>ANTHROPIC_API_KEY</code> to <code>apps/api/.env</code> and restart the API
              for real dictation.
            </div>
          )}
          <div className="panel" style={{ marginBottom: '1.25rem' }}>
            <UsageMeter usage={usage} plan={me?.plan} />
          </div>

          <div className="tabpanel" hidden={tab !== 'dictate'}>
            <DictationSurface deps={deps} onUsage={setLiveUsage} />
          </div>
          <div className="tabpanel" hidden={tab !== 'history'}>
            <HistoryPanel api={api} />
          </div>
          <div className="tabpanel" hidden={tab !== 'billing'}>
            <BillingSection api={api} me={me} usage={usage} />
          </div>
        </div>
      </main>
    </>
  );
}
