// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { App } from './App';
import { FakeApi, makeFakeDeps } from './test/fakes';
import {
  buttonByText,
  click,
  flush,
  mount,
  query,
  queryAll,
  text,
  type Mounted,
} from './test/harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.documentElement.removeAttribute('data-theme');
});

describe('App shell', () => {
  it('loads GET /v1/me into the usage meter (words + plan badge)', async () => {
    const api = new FakeApi({
      me: {
        userId: 'user_mock',
        email: 'mock@undertone.dev',
        plan: 'pro',
        trialEndsAt: null,
        usage: { wordsThisWeek: 120, limit: 50000 },
      },
    });
    mounted = await mount(<App deps={makeFakeDeps().deps} api={api} />);
    await flush();
    const meter = text(query(mounted.container, '.usage'));
    expect(meter).toContain('120 / 50,000');
    expect(meter.toLowerCase()).toContain('pro');
  });

  it('switches between the Dictate and History tabs', async () => {
    mounted = await mount(<App deps={makeFakeDeps().deps} api={new FakeApi()} />);
    await flush();
    const panels = queryAll<HTMLElement>(mounted.container, '.tabpanel');
    expect(panels[0]!.hidden).toBe(false); // dictate
    expect(panels[1]!.hidden).toBe(true); // history

    await click(buttonByText(mounted.container, 'History'));
    expect(panels[0]!.hidden).toBe(true);
    expect(panels[1]!.hidden).toBe(false);
  });

  it('shows the demo-mode banner when the API reports mock mode', async () => {
    const api = Object.assign(new FakeApi(), {
      getHealth: async () => ({ ok: true, mock: true }),
    });
    mounted = await mount(<App deps={makeFakeDeps().deps} api={api} />);
    await flush();
    const note = query<HTMLElement>(mounted.container, '.demo-note');
    expect(text(note)).toContain('Demo mode');
    expect(text(note)).toContain('DEEPGRAM_API_KEY');
  });

  it('shows no demo banner when health is unavailable or real-mode', async () => {
    mounted = await mount(<App deps={makeFakeDeps().deps} api={new FakeApi()} />);
    await flush();
    expect(mounted.container.querySelector('.demo-note')).toBeNull();
  });

  it('toggles the colour theme', async () => {
    mounted = await mount(<App deps={makeFakeDeps().deps} api={new FakeApi()} />);
    await flush();
    const themeButton = query(mounted.container, '.app-header .icon-btn');
    expect(document.documentElement.getAttribute('data-theme')).not.toBe('dark');
    await click(themeButton);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
