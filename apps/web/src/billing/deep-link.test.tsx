// @vitest-environment jsdom
// The `/app/#billing` deep-link (marketing Pro CTAs + the quota upgrade hint) must land the
// dashboard on the Billing tab. Exercised end-to-end through <App> with the shared fakes.
import { describe, it, expect, afterEach } from 'vitest';
import { App } from '../App';
import { FakeApi, makeFakeDeps } from '../test/fakes';
import { flush, mount, queryAll, run, type Mounted } from '../test/harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  window.location.hash = '';
  document.documentElement.removeAttribute('data-theme');
});

describe('App billing deep-link', () => {
  it('opens directly on the Billing tab when loaded at #billing', async () => {
    window.location.hash = '#billing';
    mounted = await mount(<App deps={makeFakeDeps().deps} api={new FakeApi()} />);
    await flush();

    const panels = queryAll<HTMLElement>(mounted.container, '.tabpanel');
    expect(panels[0]!.hidden).toBe(true); // dictate
    expect(panels[1]!.hidden).toBe(true); // history
    expect(panels[2]!.hidden).toBe(false); // billing
  });

  it('switches to Billing when the hash changes at runtime', async () => {
    mounted = await mount(<App deps={makeFakeDeps().deps} api={new FakeApi()} />);
    await flush();
    const panels = queryAll<HTMLElement>(mounted.container, '.tabpanel');
    expect(panels[2]!.hidden).toBe(true);

    await run(() => {
      window.location.hash = '#billing';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(panels[2]!.hidden).toBe(false);
  });
});
