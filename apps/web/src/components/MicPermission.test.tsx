// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { MicPermission } from './MicPermission';
import { buttonByText, click, mount, query, text, type Mounted } from '../test/harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe('MicPermission', () => {
  it('explains before the OS prompt and mounts the reassurance illustration', async () => {
    let enabled = 0;
    mounted = await mount(<MicPermission onEnable={() => (enabled += 1)} />);
    const body = text(mounted.container).toLowerCase();
    expect(body).toContain('turn on your microphone');
    // Original empty-state artwork is present and labelled for assistive tech.
    const art = query<SVGElement>(mounted.container, 'svg[role="img"]');
    expect(art.getAttribute('aria-label')).toBe('Microphone');
    await click(buttonByText(mounted.container, 'Enable microphone'));
    expect(enabled).toBe(1);
  });
});
