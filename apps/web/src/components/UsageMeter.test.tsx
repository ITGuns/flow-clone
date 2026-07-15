// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { UsageMeter } from './UsageMeter';
import { mount, query, text, type Mounted } from '../test/harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe('UsageMeter', () => {
  it('shows a loading label when usage is unknown', async () => {
    mounted = await mount(<UsageMeter usage={null} />);
    expect(text(mounted.container)).toContain('Usage loading');
  });

  it('renders words this week, the limit, and a plan badge', async () => {
    mounted = await mount(<UsageMeter usage={{ wordsThisWeek: 1200, limit: 50000 }} plan="pro" />);
    const label = text(mounted.container);
    expect(label).toContain('1,200 / 50,000 words this week');
    expect(label.toLowerCase()).toContain('pro');
    const fill = query<HTMLElement>(mounted.container, '.usage__fill');
    expect(fill.style.width).toBe('2%'); // 1200/50000 ≈ 2%
    expect(fill.classList.contains('is-over')).toBe(false);
  });

  it('clamps and flags an over-quota bar', async () => {
    mounted = await mount(<UsageMeter usage={{ wordsThisWeek: 2500, limit: 2000 }} plan="free" />);
    const fill = query<HTMLElement>(mounted.container, '.usage__fill');
    expect(fill.style.width).toBe('100%');
    expect(fill.classList.contains('is-over')).toBe(true);
  });
});
