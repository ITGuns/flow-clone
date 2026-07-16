// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { StyleSelector } from './StyleSelector';
import { buttonByText, click, mount, queryAll, type Mounted } from '../test/harness';
import type { DictationStyle } from '../register';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe('StyleSelector', () => {
  it('offers the four styles and marks the selected one', async () => {
    mounted = await mount(<StyleSelector value="document" onChange={() => undefined} />);
    const opts = queryAll<HTMLButtonElement>(mounted.container, '.styles__opt');
    expect(opts).toHaveLength(4);
    const pressed = opts.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.textContent).toContain('Document');
  });

  it('reports the chosen style on click', async () => {
    const chosen: DictationStyle[] = [];
    mounted = await mount(<StyleSelector value="document" onChange={(s) => chosen.push(s)} />);
    await click(buttonByText(mounted.container, 'Email'));
    expect(chosen).toEqual(['email']);
  });

  it('disables all options while recording', async () => {
    mounted = await mount(<StyleSelector value="chat" onChange={() => undefined} disabled />);
    const opts = queryAll<HTMLButtonElement>(mounted.container, '.styles__opt');
    expect(opts.every((b) => b.disabled)).toBe(true);
  });
});
