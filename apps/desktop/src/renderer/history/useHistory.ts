// State controller for the history view: owns the item list, cursor pagination, load/error phases,
// and the two mutations (remove one, clear all). Kept as a hook so the presentational component
// stays declarative and the async/race logic is tested in isolation.
//
// Race safety: every fresh load (mount or query change) bumps a request id; stale responses that
// resolve after a newer load began are dropped. `loadMore` ties itself to the current request id so
// a query change mid-scroll can't append an old page.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryItem } from '@undertone/shared';
import { HistoryApiError, type HistoryApi } from './history-api';

/** Phase of the primary (first-page) load. `loadingMore` is tracked separately. */
export type HistoryPhase = 'loading' | 'ready' | 'error';

export interface HistoryErrorState {
  message: string;
  retryable: boolean;
}

export interface UseHistory {
  items: HistoryItem[];
  phase: HistoryPhase;
  error: HistoryErrorState | null;
  /** True while a `loadMore` page is in flight. */
  loadingMore: boolean;
  /** True iff the server reported another page. */
  hasMore: boolean;
  /** Fetch and append the next page; no-op if none or already loading. */
  loadMore(): void;
  /** Re-run the first-page load for the current query (the error state's Retry). */
  retry(): void;
  /** Delete one item via the API and drop it from the list; rejects on API failure. */
  removeItem(id: string): Promise<void>;
  /** Delete everything via the API and empty the list; rejects on API failure. */
  clearAll(): Promise<void>;
}

/** Turn any thrown value into a safe error state (never leaks a response body / transcript text). */
function toErrorState(err: unknown): HistoryErrorState {
  if (err instanceof HistoryApiError) {
    return { message: err.message, retryable: err.retryable };
  }
  return { message: 'Something went wrong loading your history.', retryable: true };
}

/** Assemble list params, omitting empty query/cursor so the port sees only meaningful fields. */
function buildParams(
  q: string,
  cursor: string | undefined,
  pageSize: number | undefined,
): { q?: string; cursor?: string; limit?: number } {
  const params: { q?: string; cursor?: string; limit?: number } = {};
  if (q) params.q = q;
  if (cursor !== undefined && cursor !== '') params.cursor = cursor;
  if (pageSize !== undefined) params.limit = pageSize;
  return params;
}

export function useHistory(api: HistoryApi, query: string, pageSize?: number): UseHistory {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<HistoryPhase>('loading');
  const [error, setError] = useState<HistoryErrorState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Monotonic id of the current first-page load; used to discard stale async results.
  const reqId = useRef(0);
  // Latest cursor visible to async callbacks without re-binding loadMore on every page.
  const cursorRef = useRef<string | undefined>(undefined);
  cursorRef.current = nextCursor;

  const runInitial = useCallback(
    async (q: string): Promise<void> => {
      const myReq = ++reqId.current;
      setPhase('loading');
      setError(null);
      setLoadingMore(false);
      try {
        const res = await api.list(buildParams(q, undefined, pageSize));
        if (myReq !== reqId.current) return;
        setItems(res.items);
        setNextCursor(res.nextCursor);
        setPhase('ready');
      } catch (err) {
        if (myReq !== reqId.current) return;
        setError(toErrorState(err));
        setPhase('error');
      }
    },
    [api, pageSize],
  );

  useEffect(() => {
    void runInitial(query);
  }, [runInitial, query]);

  const loadMore = useCallback((): void => {
    const cursor = cursorRef.current;
    if (cursor === undefined || loadingMore) return;
    const myReq = reqId.current;
    setLoadingMore(true);
    void (async (): Promise<void> => {
      try {
        const res = await api.list(buildParams(query, cursor, pageSize));
        if (myReq !== reqId.current) return;
        setItems((prev) => [...prev, ...res.items]);
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (myReq !== reqId.current) return;
        setError(toErrorState(err));
      } finally {
        if (myReq === reqId.current) setLoadingMore(false);
      }
    })();
  }, [api, query, loadingMore, pageSize]);

  const retry = useCallback((): void => {
    void runInitial(query);
  }, [runInitial, query]);

  const removeItem = useCallback(
    async (id: string): Promise<void> => {
      await api.remove(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
    },
    [api],
  );

  const clearAll = useCallback(async (): Promise<void> => {
    await api.removeAll();
    setItems([]);
    setNextCursor(undefined);
  }, [api]);

  return {
    items,
    phase,
    error,
    loadingMore,
    hasMore: nextCursor !== undefined,
    loadMore,
    retry,
    removeItem,
    clearAll,
  };
}
