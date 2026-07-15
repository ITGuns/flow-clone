// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { BillingSection, type BillingApi } from './BillingSection';
import {
  ApiError,
  type CheckoutInterval,
  type CheckoutResponse,
  type HealthStatus,
  type MeResponse,
} from '../api/client';
import type { UsageState } from '../dictation/useDictation';
import { buttonByText, click, flush, mount, query, text, type Mounted } from '../test/harness';

// A minimal recording billing api. Both methods are always present here (the concrete client always
// implements them); optionality on WebApi only exists so the history-only fakes stay valid.
class FakeBillingApi implements BillingApi {
  readonly checkoutCalls: CheckoutInterval[] = [];
  constructor(
    private readonly opts: {
      mock?: boolean;
      checkout?: (interval: CheckoutInterval) => Promise<CheckoutResponse>;
    } = {},
  ) {}

  getHealth(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true, mock: this.opts.mock ?? false });
  }

  createCheckout(interval: CheckoutInterval): Promise<CheckoutResponse> {
    this.checkoutCalls.push(interval);
    return this.opts.checkout
      ? this.opts.checkout(interval)
      : Promise.resolve({ url: 'https://checkout.stripe.test/session/1' });
  }
}

const FREE_ME: MeResponse = {
  userId: 'u1',
  email: 'free@undertone.dev',
  plan: 'free',
  trialEndsAt: null,
  usage: { wordsThisWeek: 1500, limit: 2000 },
};

const PRO_ME: MeResponse = {
  userId: 'u2',
  email: 'pro@undertone.dev',
  plan: 'pro',
  trialEndsAt: null,
  usage: { wordsThisWeek: 4200, limit: 50000 },
};

const TRIAL_ME: MeResponse = {
  userId: 'u3',
  email: 'trial@undertone.dev',
  plan: 'pro',
  trialEndsAt: '2026-07-29T00:00:00.000Z',
  usage: { wordsThisWeek: 300, limit: 50000 },
};

const NOW = (): number => Date.parse('2026-07-15T00:00:00.000Z');

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function render(props: {
  api?: BillingApi;
  me: MeResponse | null;
  usage?: UsageState | null;
  openUrl?: (url: string, target: string) => void;
}): Promise<Mounted> {
  const m = await mount(
    <BillingSection
      api={props.api ?? new FakeBillingApi()}
      me={props.me}
      usage={props.usage ?? props.me?.usage ?? null}
      openUrl={props.openUrl}
      now={NOW}
    />,
  );
  await flush();
  return m;
}

describe('BillingSection — plan card variants', () => {
  it('renders the free plan badge + usage and shows the upgrade card', async () => {
    mounted = await render({ me: FREE_ME });
    const body = text(mounted.container);
    expect(body.toLowerCase()).toContain('free');
    expect(body).toContain('1,500 / 2,000 words this week');
    expect(body.toLowerCase()).toContain('upgrade to pro');
    // No trial line for a plain free account.
    expect(body).not.toContain('trial ends');
  });

  it('renders the pro plan without an upgrade card (portal note instead)', async () => {
    mounted = await render({ me: PRO_ME });
    const body = text(mounted.container);
    expect(body.toLowerCase()).toContain('pro');
    expect(body).toContain('4,200 / 50,000 words this week');
    expect(body.toLowerCase()).toContain("you're on pro");
    expect(body.toLowerCase()).toContain('customer portal');
    // The upgrade buttons must NOT render for a settled Pro user.
    expect(
      Array.from(mounted.container.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('Pro monthly'),
      ),
    ).toBe(false);
  });

  it('shows an honest trial-ends date AND the upgrade card while a trial is live', async () => {
    mounted = await render({ me: TRIAL_ME });
    const body = text(mounted.container);
    expect(body).toContain('Pro trial ends July 29, 2026');
    expect(body.toLowerCase()).toContain('keep pro after your trial');
    expect(buttonByText(mounted.container, 'Pro monthly')).toBeTruthy();
  });

  it('renders a loading placeholder when me is null', async () => {
    mounted = await render({ me: null });
    expect(text(mounted.container).toLowerCase()).toContain('loading your plan');
  });
});

describe('BillingSection — checkout upgrade path', () => {
  it('calls createCheckout with "monthly" and, in mock mode, shows the test-mode note (no window.open)', async () => {
    const api = new FakeBillingApi({
      mock: true,
      checkout: () => Promise.resolve({ url: 'https://checkout.stripe.test/session/42' }),
    });
    const opened: string[] = [];
    mounted = await render({ me: FREE_ME, api, openUrl: (url) => opened.push(url) });

    await click(buttonByText(mounted.container, 'Pro monthly'));

    expect(api.checkoutCalls).toEqual(['monthly']);
    expect(opened).toEqual([]); // mock mode must NOT open a window
    const note = text(query(mounted.container, '.result__note'));
    expect(note.toLowerCase()).toContain('test mode');
    expect(note).toContain('https://checkout.stripe.test/session/42');
  });

  it('calls createCheckout with "yearly" and, in real mode, opens the URL in a new tab', async () => {
    const api = new FakeBillingApi({
      mock: false,
      checkout: () => Promise.resolve({ url: 'https://checkout.stripe.example/live/7' }),
    });
    const opened: Array<[string, string]> = [];
    mounted = await render({
      me: FREE_ME,
      api,
      openUrl: (url, target) => opened.push([url, target]),
    });

    await click(buttonByText(mounted.container, 'Pro yearly'));

    expect(api.checkoutCalls).toEqual(['yearly']);
    expect(opened).toEqual([['https://checkout.stripe.example/live/7', '_blank']]);
    const note = text(query(mounted.container, '.result__note'));
    expect(note.toLowerCase()).toContain('checkout opened');
    expect(note).toContain('https://checkout.stripe.example/live/7');
  });

  it('surfaces a "sign in again" message on a 401', async () => {
    const api = new FakeBillingApi({
      mock: false,
      checkout: () => Promise.reject(new ApiError('auth', 'request failed (401)', 401)),
    });
    const opened: string[] = [];
    mounted = await render({ me: FREE_ME, api, openUrl: (url) => opened.push(url) });

    await click(buttonByText(mounted.container, 'Pro monthly'));

    const alert = query(mounted.container, '.result__note--warn');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert).toLowerCase()).toContain('sign in again');
    expect(opened).toEqual([]);
  });

  it('surfaces a retryable network message and stays clickable', async () => {
    const api = new FakeBillingApi({
      mock: false,
      checkout: () => Promise.reject(new ApiError('network', 'could not reach the service')),
    });
    mounted = await render({ me: FREE_ME, api });

    await click(buttonByText(mounted.container, 'Pro monthly'));

    expect(text(query(mounted.container, '.result__note--warn')).toLowerCase()).toContain(
      "couldn't reach",
    );
    // The button is not left disabled after a failure.
    expect(buttonByText(mounted.container, 'Pro monthly').disabled).toBe(false);
  });
});
