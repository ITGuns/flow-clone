// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { HistoryView } from '../history';
import { FakeHistoryApi, HistoryApiError } from '../history';
import {
  mount,
  click,
  typeInto,
  flush,
  buttonByText,
  findButtonByText,
  query,
  queryAll,
} from './dom-harness';
import { makeItem, makeSeries } from './test-fixtures';

const NOW = new Date('2026-07-15T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Advance fake timers by `ms` inside act(), then drain promise microtasks. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

function rowCount(container: HTMLElement): number {
  return queryAll(container, '.uth-row').length;
}
function searchBox(container: HTMLElement): HTMLInputElement {
  return query<HTMLInputElement>(container, 'input[type="search"]');
}

describe('HistoryView — initial load + empty states', () => {
  it('renders rows for existing history with app name, register badge and word count', async () => {
    const api = new FakeHistoryApi([
      makeItem({
        id: 'a',
        text: 'ship it today',
        appName: 'Slack',
        register: 'chat',
        wordCount: 3,
      }),
    ]);
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    expect(rowCount(view.container)).toBe(1);
    const text = view.container.textContent ?? '';
    expect(text).toContain('ship it today');
    expect(text).toContain('Slack');
    expect(text).toContain('chat');
    expect(text).toContain('3 words');
    expect(query(view.container, '.uth-badge').textContent).toBe('chat');
    await view.unmount();
  });

  it('shows the "no history yet" empty state when there is nothing', async () => {
    const api = new FakeHistoryApi([]);
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();
    expect(view.container.textContent ?? '').toContain('No history yet');
    // no clear-all offered when empty
    expect(findButtonByText(view.container, 'Clear all history')).toBeNull();
    await view.unmount();
  });
});

describe('HistoryView — debounced search', () => {
  it('filters the list only after the 250ms debounce window', async () => {
    const api = new FakeHistoryApi([
      makeItem({ id: 'a', text: 'alpha one', createdAt: '2026-07-15T12:00:00.000Z' }),
      makeItem({ id: 'b', text: 'beta two', createdAt: '2026-07-15T11:00:00.000Z' }),
      makeItem({ id: 'c', text: 'alpha three', createdAt: '2026-07-15T10:00:00.000Z' }),
    ]);
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();
    expect(rowCount(view.container)).toBe(3);

    await typeInto(searchBox(view.container), 'alpha');
    // Debounce pending → list unchanged.
    await advance(200);
    expect(rowCount(view.container)).toBe(3);

    // Cross the debounce threshold → filtered fetch runs.
    await advance(60);
    expect(rowCount(view.container)).toBe(2);
    expect(view.container.textContent ?? '').not.toContain('beta two');
    await view.unmount();
  });

  it('coalesces rapid keystrokes into a single settle (timer resets on change)', async () => {
    const api = new FakeHistoryApi(
      makeSeries(4, (i) => (i === 0 ? 'unique needle' : `filler ${i}`)),
    );
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    await typeInto(searchBox(view.container), 'unique');
    await advance(200); // not yet
    await typeInto(searchBox(view.container), 'unique needle');
    await advance(200); // timer reset → still not fired
    expect(rowCount(view.container)).toBe(4);
    await advance(60); // now it settles
    expect(rowCount(view.container)).toBe(1);
    await view.unmount();
  });

  it('shows the "no matches" empty state (distinct from "no history yet")', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    await typeInto(searchBox(view.container), 'zzzznope');
    await advance(300);
    const text = view.container.textContent ?? '';
    expect(text).toContain('No matches');
    expect(text).not.toContain('No history yet');
    await view.unmount();
  });
});

describe('HistoryView — cursor pagination (load more)', () => {
  it('appends the next page and hides the button on the last page', async () => {
    const api = new FakeHistoryApi(makeSeries(5));
    const view = await mount(<HistoryView api={api} pageSize={2} now={NOW} />);
    await flush();
    expect(rowCount(view.container)).toBe(2);

    await click(buttonByText(view.container, 'Load more'));
    expect(rowCount(view.container)).toBe(4);

    await click(buttonByText(view.container, 'Load more'));
    expect(rowCount(view.container)).toBe(5);
    // last page → no more button
    expect(findButtonByText(view.container, 'Load more')).toBeNull();
    await view.unmount();
  });
});

describe('HistoryView — per-item delete', () => {
  it('confirms, calls api.remove, and drops the row', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const removeSpy = vi.spyOn(api, 'remove');
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();
    expect(rowCount(view.container)).toBe(3);

    const firstRow = query(view.container, '.uth-row');
    await click(buttonByText(firstRow, 'Delete')); // opens confirm
    // confirm affordance visible
    expect(firstRow.textContent ?? '').toContain('Delete this?');
    await click(buttonByText(firstRow, 'Delete')); // the danger confirm

    expect(removeSpy).toHaveBeenCalledWith('i0');
    expect(rowCount(view.container)).toBe(2);
    expect(view.container.textContent ?? '').not.toContain('note 0');
    await view.unmount();
  });

  it('cancel from the confirm leaves the row intact and calls nothing', async () => {
    const api = new FakeHistoryApi(makeSeries(2));
    const removeSpy = vi.spyOn(api, 'remove');
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    const firstRow = query(view.container, '.uth-row');
    await click(buttonByText(firstRow, 'Delete'));
    await click(buttonByText(firstRow, 'Cancel'));
    expect(removeSpy).not.toHaveBeenCalled();
    expect(rowCount(view.container)).toBe(2);
    await view.unmount();
  });

  it('a failing delete shows an inline retryable error and keeps the row', async () => {
    const api = new FakeHistoryApi(makeSeries(2));
    vi.spyOn(api, 'remove').mockRejectedValue(
      new HistoryApiError('server', 'nope', { status: 500 }),
    );
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    const firstRow = query(view.container, '.uth-row');
    await click(buttonByText(firstRow, 'Delete'));
    await click(buttonByText(firstRow, 'Delete'));
    expect(firstRow.textContent ?? '').toContain('Couldn’t delete');
    expect(buttonByText(firstRow, 'Try again')).toBeTruthy();
    expect(rowCount(view.container)).toBe(2);
    await view.unmount();
  });
});

describe('HistoryView — clear all (typed confirm gate)', () => {
  it('gates deletion behind typing the exact confirm word', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const clearSpy = vi.spyOn(api, 'removeAll');
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    await click(buttonByText(view.container, 'Clear all history'));
    const confirmBtn = buttonByText(view.container, 'Delete everything');
    expect(confirmBtn.disabled).toBe(true);

    const input = query<HTMLInputElement>(view.container, '.uth-clearall-input');
    await typeInto(input, 'delete'); // wrong case → still gated
    expect(buttonByText(view.container, 'Delete everything').disabled).toBe(true);
    expect(clearSpy).not.toHaveBeenCalled();

    await typeInto(input, 'DELETE');
    expect(buttonByText(view.container, 'Delete everything').disabled).toBe(false);

    await click(buttonByText(view.container, 'Delete everything'));
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(rowCount(view.container)).toBe(0);
    expect(view.container.textContent ?? '').toContain('No history yet');
    await view.unmount();
  });
});

describe('HistoryView — error + retry', () => {
  it('renders an honest retryable error and recovers on Try again', async () => {
    const api = new FakeHistoryApi(makeSeries(2), {
      failList: new HistoryApiError('server', 'history service is down', { status: 503 }),
    });
    const view = await mount(<HistoryView api={api} now={NOW} />);
    await flush();

    expect(view.container.textContent ?? '').toContain('history service is down');
    const retry = buttonByText(view.container, 'Try again');

    api.setFailList(undefined);
    await click(retry);
    expect(rowCount(view.container)).toBe(2);
    await view.unmount();
  });
});
