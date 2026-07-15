// History tab — GET /v1/history with exact-word search (§5/§7), cursor "load more", and per-item
// delete. Search is debounced. Adapts the desktop history-view patterns as web-native code (no
// cross-app imports).
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { HistoryItem, WebApi } from '../api/client';
import { formatRelative } from './relative-time';
import { TrashIcon } from './icons';

export interface HistoryPanelProps {
  api: WebApi;
  /** Search debounce in ms (tests lower it / drive fake timers). */
  debounceMs?: number;
  /** Clock for relative timestamps; injected in tests. */
  now?: () => number;
}

export function HistoryPanel({ api, debounceMs = 300, now }: HistoryPanelProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const load = useCallback(
    async (q: string): Promise<void> => {
      const gen = ++genRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.listHistory(q ? { q } : {});
        if (gen !== genRef.current) return;
        setItems(res.items);
        setCursor(res.nextCursor);
      } catch {
        if (gen === genRef.current) setError('Could not load your history.');
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
    },
    [api],
  );

  // Debounced (re)load on query change; the empty initial query loads the first page too.
  useEffect(() => {
    const timer = setTimeout(() => void load(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs, load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!cursor) return;
    setLoading(true);
    try {
      const res = await api.listHistory(query ? { q: query, cursor } : { cursor });
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch {
      setError('Could not load more.');
    } finally {
      setLoading(false);
    }
  }, [api, cursor, query]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await api.deleteHistory(id);
        setItems((prev) => prev.filter((item) => item.id !== id));
      } catch {
        setError('Could not delete that entry.');
      }
    },
    [api],
  );

  return (
    <section className="panel" aria-label="History">
      <h2>History</h2>
      <div className="history__search">
        <input
          className="input"
          type="search"
          value={query}
          placeholder="Search your words (exact match)"
          aria-label="Search history"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error ? (
        <div className="result__note result__note--warn" role="alert">
          {error}
        </div>
      ) : null}

      {items.length === 0 && !loading ? (
        <p className="history__empty">
          {query ? 'No matching dictations.' : 'Your dictations will appear here.'}
        </p>
      ) : (
        <ul className="history__list">
          {items.map((item) => (
            <li key={item.id} className="history__item">
              <div className="grow">
                <div className="session__meta">
                  <span className="tag">{item.register}</span>
                  <span>{item.appName}</span>
                  <span>{item.wordCount} words</span>
                  <span>{formatRelative(item.createdAt, now?.())}</span>
                </div>
                <p className="session__text">{item.text}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Delete entry"
                onClick={() => void remove(item.id)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
