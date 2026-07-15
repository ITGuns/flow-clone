// Billing section — plan visibility + the upgrade path over the existing Stripe checkout endpoint
// (POST /v1/billing/checkout, task 4i). Two cards:
//   • Current plan — the plan badge from GET /v1/me, an honest "Pro trial ends <date>" line while a
//     trial is live, and the weekly words-used-vs-limit reusing the meter data.
//   • Upgrade — shown while the effective plan is 'free' OR a trial is active: monthly/yearly Pro
//     buttons that call createCheckout(interval).
// Pro users past their trial see "You're on Pro" plus an honest note that self-serve plan management
// arrives with the customer portal (not built here — we don't fake it).
//
// Mock mode: the api returns a fake checkout URL that won't resolve. We detect it via /healthz
// (`mock:true`) and, in that case, render a "Test mode" confirmation with the URL string INSTEAD of
// opening a window. Real mode opens the URL in a new tab and echoes it inline with a note.
//
// Styling reuses the existing design-token classes (.panel/.result/.badge/.btn/.result__note) so the
// section matches the rest of the dashboard (terracotta + serif, light/dark, WCAG AA) without new CSS.
import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react';
import {
  ApiError,
  type CheckoutInterval,
  type CheckoutResponse,
  type HealthStatus,
  type MeResponse,
} from '../api/client';
import type { UsageState } from '../dictation/useDictation';
import { PRO_MONTHLY_USD, PRO_YEARLY_USD, YEARLY_FREE_MONTHS } from './plans';

/** The narrow slice of the api the billing section needs (both methods optional — see WebApi). */
export interface BillingApi {
  createCheckout?(interval: CheckoutInterval): Promise<CheckoutResponse>;
  getHealth?(): Promise<HealthStatus>;
}

export interface BillingSectionProps {
  api: BillingApi;
  /** GET /v1/me result (plan, trialEndsAt) — null while loading. */
  me: MeResponse | null;
  /** Live-or-loaded usage, reused from the meter. */
  usage: UsageState | null;
  /** Test seam for the new-tab open; defaults to window.open. */
  openUrl?: (url: string, target: string) => void;
  /** Clock for the trial-active check; injected in tests. */
  now?: () => number;
}

type CheckoutState =
  | { kind: 'idle' }
  | { kind: 'loading'; interval: CheckoutInterval }
  | { kind: 'test-mode'; url: string }
  | { kind: 'opened'; url: string }
  | { kind: 'error'; message: string };

const URL_STYLE: CSSProperties = { display: 'block', marginTop: '0.5rem', wordBreak: 'break-all' };
const ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  marginTop: '1rem',
};

function formatWords(n: number): string {
  return n.toLocaleString('en-US');
}

/** Format an ISO date as "July 29, 2026" in UTC (stable regardless of the viewer's timezone). */
function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function isTrialActive(me: MeResponse, nowMs: number): boolean {
  if (me.trialEndsAt === null) return false;
  const ends = new Date(me.trialEndsAt).getTime();
  return !Number.isNaN(ends) && ends > nowMs;
}

function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'auth') return 'Your session expired — please sign in again.';
    if (err.kind === 'network') {
      return "Couldn't reach the service. Check your connection and try again.";
    }
  }
  return 'Something went wrong starting checkout. Please try again.';
}

export function BillingSection({ api, me, usage, openUrl, now }: BillingSectionProps): JSX.Element {
  const [mock, setMock] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: 'idle' });

  // Detect mock mode once on mount so the upgrade buttons know whether the checkout URL resolves.
  useEffect(() => {
    let cancelled = false;
    const getHealth = api.getHealth?.bind(api);
    if (!getHealth) return;
    getHealth()
      .then((h) => {
        if (!cancelled) setMock(h.mock);
      })
      .catch(() => {
        /* health unknown — treat as real mode (safer: don't suppress window.open) */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const startCheckout = useCallback(
    async (interval: CheckoutInterval): Promise<void> => {
      const createCheckout = api.createCheckout?.bind(api);
      if (!createCheckout) {
        setCheckout({ kind: 'error', message: 'Checkout is unavailable right now.' });
        return;
      }
      setCheckout({ kind: 'loading', interval });
      try {
        const { url } = await createCheckout(interval);
        if (mock) {
          setCheckout({ kind: 'test-mode', url });
        } else {
          (openUrl ?? ((u, t) => void window.open(u, t)))(url, '_blank');
          setCheckout({ kind: 'opened', url });
        }
      } catch (err) {
        setCheckout({ kind: 'error', message: messageForError(err) });
      }
    },
    [api, mock, openUrl],
  );

  if (!me) {
    return (
      <section className="panel" aria-label="Billing">
        <h2>Billing</h2>
        <p className="muted">Loading your plan…</p>
      </section>
    );
  }

  const nowMs = now?.() ?? Date.now();
  const trialActive = isTrialActive(me, nowMs);
  const showUpgrade = me.plan === 'free' || trialActive;
  const busy = checkout.kind === 'loading';

  return (
    <section className="panel" aria-label="Billing">
      <h2>Billing</h2>
      <div className="stack">
        {/* ── Current plan ─────────────────────────────────────────────────── */}
        <div className="result">
          <div className="result__head">
            <span className="result__status">Current plan</span>
            <span className="result__spacer" />
            <span className={`badge${me.plan === 'pro' ? ' badge--pro' : ''}`}>{me.plan}</span>
          </div>

          {trialActive && me.trialEndsAt !== null ? (
            <p style={{ margin: '0 0 0.5rem' }}>Pro trial ends {formatDate(me.trialEndsAt)}</p>
          ) : null}

          <p className="muted" style={{ margin: 0 }}>
            {usage
              ? `${formatWords(usage.wordsThisWeek)} / ${formatWords(usage.limit)} words this week`
              : 'Usage loading…'}
          </p>
        </div>

        {/* ── Upgrade OR "on Pro" note ─────────────────────────────────────── */}
        {showUpgrade ? (
          <div className="result">
            <p className="result__status" style={{ margin: '0 0 0.35rem' }}>
              {trialActive ? 'Keep Pro after your trial' : 'Upgrade to Pro'}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              More words every week, priority formatting, and a larger dictionary.
            </p>

            <div style={ACTIONS_STYLE}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-busy={checkout.kind === 'loading' && checkout.interval === 'monthly'}
                onClick={() => void startCheckout('monthly')}
              >
                Pro monthly — ${PRO_MONTHLY_USD}/mo
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                aria-busy={checkout.kind === 'loading' && checkout.interval === 'yearly'}
                onClick={() => void startCheckout('yearly')}
              >
                Pro yearly — ${PRO_YEARLY_USD}/yr ({YEARLY_FREE_MONTHS} months free)
              </button>
            </div>

            {checkout.kind === 'test-mode' ? (
              <div className="result__note" role="status">
                <strong>Test mode:</strong> checkout session created. In production this opens
                Stripe; here the URL is a stub that won&apos;t resolve.
                <code style={URL_STYLE}>{checkout.url}</code>
              </div>
            ) : null}

            {checkout.kind === 'opened' ? (
              <div className="result__note" role="status">
                <strong>Checkout opened in a new tab.</strong> If it didn&apos;t appear, use this
                link:
                <a style={URL_STYLE} href={checkout.url} target="_blank" rel="noreferrer">
                  {checkout.url}
                </a>
              </div>
            ) : null}

            {checkout.kind === 'error' ? (
              <div className="result__note result__note--warn" role="alert">
                {checkout.message}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="result">
            <p className="result__status" style={{ margin: '0 0 0.35rem' }}>
              You&apos;re on Pro
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Thanks for subscribing. Self-serve plan management (change cadence, update card,
              cancel) arrives with the customer portal — it isn&apos;t available yet.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
