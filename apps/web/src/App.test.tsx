// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { App, type BrowserSpeechProvider } from './App';
import { FakeApi, FakeRecognizer, makeFakeDeps } from './test/fakes';
import type { HealthStatus } from './api/client';
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

/** A FakeApi with a scripted `/healthz` response (App reads it to pick the speech mode). */
function apiWithHealth(health: HealthStatus): FakeApi {
  return Object.assign(new FakeApi(), { getHealth: () => Promise.resolve(health) });
}

const supportedSpeech: BrowserSpeechProvider = {
  supported: () => true,
  createRecognizer: () => new FakeRecognizer(),
};
const unsupportedSpeech: BrowserSpeechProvider = {
  supported: () => false,
  createRecognizer: () => new FakeRecognizer(),
};

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

  it('shows the browser-speech note (not the demo banner) when browser mode is active', async () => {
    const api = apiWithHealth({ ok: true, mock: true });
    mounted = await mount(
      <App deps={makeFakeDeps().deps} api={api} browserSpeech={supportedSpeech} />,
    );
    await flush();
    const note = query<HTMLElement>(mounted.container, '.speech-note');
    const body = text(note).toLowerCase();
    expect(body).toContain('built-in speech recognition');
    expect(body).toContain('no api keys needed');
    expect(body).toContain('google'); // honest privacy note — audio goes to the browser vendor
    expect(mounted.container.querySelector('.demo-note')).toBeNull();
  });

  it('falls back to the demo banner when the browser has no speech recognition (e.g. Firefox)', async () => {
    const api = apiWithHealth({ ok: true, mock: true });
    mounted = await mount(
      <App deps={makeFakeDeps().deps} api={api} browserSpeech={unsupportedSpeech} />,
    );
    await flush();
    const note = query<HTMLElement>(mounted.container, '.demo-note');
    expect(text(note)).toContain('Demo mode');
    expect(mounted.container.querySelector('.speech-note')).toBeNull();
  });

  it('shows no note at all when the server does real speech', async () => {
    const api = apiWithHealth({ ok: true, mock: false, speech: 'real' });
    mounted = await mount(
      <App deps={makeFakeDeps().deps} api={api} browserSpeech={supportedSpeech} />,
    );
    await flush();
    expect(mounted.container.querySelector('.speech-note')).toBeNull();
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
