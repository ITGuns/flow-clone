// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';
import { FakeApi } from '../test/fakes';
import {
  buttonByText,
  click,
  mount,
  query,
  queryAll,
  run,
  text,
  typeInto,
  type Mounted,
} from '../test/harness';
import type { HistoryItem } from '../api/client';

function item(over: Partial<HistoryItem>): HistoryItem {
  return {
    id: 'id-1',
    text: 'A dictated line.',
    appName: 'Undertone Web',
    register: 'document',
    wordCount: 3,
    createdAt: '2026-07-15T11:00:00Z',
    ...over,
  };
}

let mounted: Mounted | null = null;

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('HistoryPanel', () => {
  it('loads the first page after the debounce and renders rows', async () => {
    const api = new FakeApi({
      history: () => ({ items: [item({ id: 'a', text: 'first entry' })] }),
    });
    mounted = await mount(<HistoryPanel api={api} debounceMs={200} now={() => Date.now()} />);
    await run(() => vi.advanceTimersByTime(200));
    expect(text(mounted.container)).toContain('first entry');
    expect(api.listCalls[0]).toEqual({});
  });

  it('searches with the query after debounce (exact-word §5/§7)', async () => {
    const api = new FakeApi({
      history: (p) => ({ items: [item({ id: p.q ?? 'none', text: `q=${p.q ?? ''}` })] }),
    });
    mounted = await mount(<HistoryPanel api={api} debounceMs={200} />);
    await run(() => vi.advanceTimersByTime(200)); // initial
    await typeInto(query<HTMLInputElement>(mounted.container, 'input[type="search"]'), 'deck');
    await run(() => vi.advanceTimersByTime(200));
    expect(api.listCalls.some((c) => c.q === 'deck')).toBe(true);
    expect(text(mounted.container)).toContain('q=deck');
  });

  it('deletes an item and removes its row', async () => {
    const api = new FakeApi({
      history: () => ({ items: [item({ id: 'del-me', text: 'delete this' })] }),
    });
    mounted = await mount(<HistoryPanel api={api} debounceMs={0} />);
    await run(() => vi.advanceTimersByTime(0));
    expect(text(mounted.container)).toContain('delete this');
    await click(query(mounted.container, 'button[aria-label="Delete entry"]'));
    expect(api.deleted).toEqual(['del-me']);
    expect(text(mounted.container)).not.toContain('delete this');
  });

  it('loads more using the cursor and appends rows', async () => {
    const api = new FakeApi({
      history: (p) =>
        p.cursor === undefined
          ? { items: [item({ id: 'p1', text: 'page one' })], nextCursor: 'CUR' }
          : { items: [item({ id: 'p2', text: 'page two' })] },
    });
    mounted = await mount(<HistoryPanel api={api} debounceMs={0} />);
    await run(() => vi.advanceTimersByTime(0));
    expect(text(mounted.container)).toContain('page one');
    await click(buttonByText(mounted.container, 'Load more'));
    const rows = queryAll(mounted.container, '.history__item');
    expect(rows).toHaveLength(2);
    expect(text(mounted.container)).toContain('page two');
    expect(api.listCalls.some((c) => c.cursor === 'CUR')).toBe(true);
  });

  it('shows an empty state with its illustration when there is no history', async () => {
    const api = new FakeApi({ history: () => ({ items: [] }) });
    mounted = await mount(<HistoryPanel api={api} debounceMs={0} />);
    await run(() => vi.advanceTimersByTime(0));
    expect(text(mounted.container).toLowerCase()).toContain('will appear here');
    const art = query<SVGElement>(mounted.container, '.empty-state svg[role="img"]');
    expect(art.getAttribute('aria-label')).toBe('No history yet');
  });

  it('mounts the error illustration and keeps content visible when the load fails', async () => {
    const api = new FakeApi({
      history: () => {
        throw new Error('boom');
      },
    });
    mounted = await mount(<HistoryPanel api={api} debounceMs={0} />);
    await run(() => vi.advanceTimersByTime(0));
    const body = text(mounted.container).toLowerCase();
    expect(body).toContain('could not load your history');
    const art = query<SVGElement>(mounted.container, '.empty-state svg[role="img"]');
    expect(art.getAttribute('aria-label')).toBe('Something went wrong');
  });
});
