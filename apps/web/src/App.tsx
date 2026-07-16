// Dashboard shell: header (brand, tab switch, usage meter, theme toggle) + the two tabs. Both tabs
// stay mounted (toggled with `hidden`) so the WS connection persists across tab switches. The api +
// dictation deps are injected so the whole shell is testable with fakes.
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { DictationDeps, UsageState } from './dictation/useDictation';
import type { BrowserDictationDeps } from './dictation/useBrowserDictation';
import type { MeResponse, WebApi } from './api/client';
import { DictationSurface } from './components/DictationSurface';
import { HistoryPanel } from './components/HistoryPanel';
import { UsageMeter } from './components/UsageMeter';
import { BillingSection } from './billing/BillingSection';
import { BrandMark, ThemeIcon } from './components/icons';
import {
  BrowserRecognizer,
  isBrowserSpeechSupported,
  windowSpeechRecognitionCtor,
  type Recognizer,
} from './speech/browser-recognizer';
import { THEME_STORAGE_KEY, nextTheme, type Theme } from './theme';

/** Provides browser-native speech: whether the vendor recognizer exists + a factory for it. */
export interface BrowserSpeechProvider {
  supported(): boolean;
  createRecognizer(): Recognizer;
}

/** Default provider over the real Web Speech API (Chrome/Edge `webkitSpeechRecognition`). */
const DEFAULT_BROWSER_SPEECH: BrowserSpeechProvider = {
  supported: () => isBrowserSpeechSupported(),
  createRecognizer: () => {
    const ctor = windowSpeechRecognitionCtor();
    if (!ctor) throw new Error('Web Speech recognition unavailable');
    return new BrowserRecognizer(() => new ctor());
  },
};

export interface AppProps {
  deps: DictationDeps;
  api: WebApi;
  /** Browser-native speech provider; defaults to the real Web Speech API. Injected in tests. */
  browserSpeech?: BrowserSpeechProvider;
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

export function App({ deps, api, browserSpeech }: AppProps): JSX.Element {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [liveUsage, setLiveUsage] = useState<UsageState | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme());
  // null = unknown (health not resolved / unavailable) → assume real, no note, WS mode.
  const [speechIsReal, setSpeechIsReal] = useState<boolean | null>(null);

  const provider = browserSpeech ?? DEFAULT_BROWSER_SPEECH;
  const browserSupported = useMemo(() => provider.supported(), [provider]);
  const formatTranscript = api.formatTranscript?.bind(api);

  // Speech mode: when the server isn't doing real ASR (speech !== 'real') and this browser CAN
  // recognize speech AND the format endpoint is available, dictation runs on browser-native speech.
  const browserMode = speechIsReal === false && browserSupported && formatTranscript !== undefined;

  const browserDeps: BrowserDictationDeps | undefined =
    browserMode && formatTranscript
      ? {
          createRecognizer: () => provider.createRecognizer(),
          formatTranscript: (transcript, appContext) => formatTranscript(transcript, appContext),
        }
      : undefined;

  // Resolve the server's speech mode (D-026 hybrid): 'real' = live ASR+formatting; anything else
  // (mock/partial) means dictation should not stream to canned fixtures — drive it from the browser
  // when possible, else show the demo note. Fall back to the coarse `mock` flag for older servers.
  useEffect(() => {
    let cancelled = false;
    api
      .getHealth?.()
      .then((h) => {
        if (cancelled || !h) return;
        setSpeechIsReal(h.speech ? h.speech === 'real' : !h.mock);
      })
      .catch(() => {
        /* unknown health — assume real, no note */
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
          {browserMode ? (
            <div className="panel speech-note" role="note" style={{ marginBottom: '1.25rem' }}>
              <strong>Using your browser&apos;s built-in speech recognition</strong> — no API keys
              needed. Voice commands like <code>period</code> and <code>scratch that</code> work
              today; formatting is mechanical cleanup until an <code>ANTHROPIC_API_KEY</code> is
              added, then it becomes full AI formatting. Recognition is performed by your browser
              vendor — Chrome sends the audio to Google&apos;s speech service — and only the
              resulting text reaches Undertone.
            </div>
          ) : speechIsReal === false ? (
            <div className="panel demo-note" role="note" style={{ marginBottom: '1.25rem' }}>
              <strong>Demo mode.</strong> Speech keys aren&apos;t configured and this browser has no
              built-in speech recognition, so releases return sample transcripts — not your words.
              The mic level, streaming, formatting, and history are all live. Add{' '}
              <code>DEEPGRAM_API_KEY</code> and <code>ANTHROPIC_API_KEY</code> to{' '}
              <code>apps/api/.env</code> and restart the API for real dictation.
            </div>
          ) : null}
          <div className="panel" style={{ marginBottom: '1.25rem' }}>
            <UsageMeter usage={usage} plan={me?.plan} />
          </div>

          <div className="tabpanel" hidden={tab !== 'dictate'}>
            <DictationSurface
              deps={deps}
              mode={browserMode ? 'browser' : 'ws'}
              {...(browserDeps ? { browser: browserDeps } : {})}
              onUsage={setLiveUsage}
            />
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
