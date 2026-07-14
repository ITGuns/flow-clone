// Shared builders for the history tests. Not a `.test` file (typechecked with the sources, never run
// as a suite) so multiple test files can seed deterministic HistoryItems without duplication.
import type { HistoryItem } from '@undertone/shared';
import { wordsOf } from './fake-history-api';

/** Build a HistoryItem with sensible defaults; `id` is required so ordering ties are deterministic. */
export function makeItem(over: Partial<HistoryItem> & { id: string }): HistoryItem {
  const text = over.text ?? 'hello world';
  return {
    id: over.id,
    text,
    appName: over.appName ?? 'Slack',
    register: over.register ?? 'chat',
    wordCount: over.wordCount ?? wordsOf(text).length,
    createdAt: over.createdAt ?? '2026-07-15T12:00:00.000Z',
  };
}

/** N items with strictly descending timestamps (newest = index 0), ids i0..i{N-1}. */
export function makeSeries(n: number, textFor: (i: number) => string = (i) => `note ${i}`): HistoryItem[] {
  const base = Date.parse('2026-07-15T12:00:00.000Z');
  return Array.from({ length: n }, (_, i) =>
    makeItem({
      id: `i${i}`,
      text: textFor(i),
      createdAt: new Date(base - i * 60_000).toISOString(),
    }),
  );
}
