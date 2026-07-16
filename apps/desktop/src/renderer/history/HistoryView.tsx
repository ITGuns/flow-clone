// The history view (task 4b): searchable, cursor-paginated, deletable transcript history, backed by
// any `HistoryApi`. Server-stored history displayed in the desktop app — there is no web dashboard
// in v1 (guide §3 scope). Composition:
//   search box (debounced 250ms, exact-word semantics)  →  useHistory(api, debouncedQuery)
//   → loading / error / empty(no-history | no-matches) / list(rows) + load-more
//   → clear-all with a typed confirm gate.
//
// Privacy (guide §3): transcript text is rendered for its owner but never logged; this component
// makes no console calls.
import { useId, useState, type ReactElement } from 'react';
import { CLEAR_ALL_CONFIRM_WORD, SEARCH_PLACEHOLDER } from './history-copy';
import { HISTORY_CSS, HISTORY_STYLE_ID } from './history-styles';
import { HistoryItemRow } from './HistoryItemRow';
import type { HistoryApi } from './history-api';
import { useDebouncedValue } from './useDebouncedValue';
import { useHistory } from './useHistory';

export interface HistoryViewProps {
  api: HistoryApi;
  /** Debounce window for the search box; defaults to 250ms (task spec). Overridable for tests. */
  searchDebounceMs?: number;
  /** Page size hint passed to the API as `limit` (server clamps). Drives load-more pagination. */
  pageSize?: number;
  /** Injected "now" for deterministic relative timestamps in tests. */
  now?: Date;
}

/** Emit the shared stylesheet once (no build-time CSS pipeline yet — see history-styles.ts). */
function HistoryStyles(): ReactElement {
  return <style id={HISTORY_STYLE_ID}>{HISTORY_CSS}</style>;
}

export function HistoryView({
  api,
  searchDebounceMs = 250,
  pageSize,
  now,
}: HistoryViewProps): ReactElement {
  const [rawQuery, setRawQuery] = useState('');
  const query = useDebouncedValue(rawQuery, searchDebounceMs);
  const history = useHistory(api, query, pageSize);

  const searchId = useId();
  const hintId = useId();

  const [clearOpen, setClearOpen] = useState(false);
  const [clearInput, setClearInput] = useState('');
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState(false);

  const isSearching = query.trim() !== '';

  async function confirmClearAll(): Promise<void> {
    setClearBusy(true);
    setClearError(false);
    try {
      await history.clearAll();
      setClearOpen(false);
      setClearInput('');
    } catch {
      setClearError(true);
    } finally {
      setClearBusy(false);
    }
  }

  function renderBody(): ReactElement {
    if (history.phase === 'loading') {
      return (
        <div className="uth-loading" role="status">
          <span className="uth-spinner" aria-hidden="true" />
          Loading your history…
        </div>
      );
    }
    if (history.phase === 'error') {
      return (
        <div className="uth-error" role="alert">
          <p>{history.error?.message ?? 'Something went wrong.'}</p>
          {history.error?.retryable !== false ? (
            <button type="button" className="uth-btn" onClick={history.retry}>
              Try again
            </button>
          ) : null}
        </div>
      );
    }
    if (history.items.length === 0) {
      return isSearching ? (
        <div className="uth-empty" role="status">
          <p className="uth-empty-title">No matches</p>
          <p>No dictations contain all of those words. Search matches whole words only.</p>
        </div>
      ) : (
        <div className="uth-empty" role="status">
          <p className="uth-empty-title">No history yet</p>
          <p>Your dictations will appear here once you start using Undertone.</p>
        </div>
      );
    }
    return (
      <>
        <ul className="uth-list">
          {history.items.map((item) => (
            <HistoryItemRow
              key={item.id}
              item={item}
              {...(now ? { now } : {})}
              onDelete={history.removeItem}
            />
          ))}
        </ul>
        {history.hasMore ? (
          <div className="uth-more">
            <button
              type="button"
              className="uth-btn"
              onClick={history.loadMore}
              disabled={history.loadingMore}
            >
              {history.loadingMore ? <span className="uth-spinner" aria-hidden="true" /> : null}
              {history.loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  const canClearAll = history.phase === 'ready' && history.items.length > 0;

  return (
    <div className="uth-root">
      <HistoryStyles />
      <header className="uth-header">
        <h2 className="uth-title">History</h2>
        <div className="uth-search-wrap">
          <label htmlFor={searchId} className="uth-search-label">
            Search history
          </label>
          <input
            id={searchId}
            type="search"
            className="uth-search"
            placeholder={SEARCH_PLACEHOLDER}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            aria-describedby={hintId}
          />
          <p id={hintId} className="uth-hint">
            Matches whole words only.
          </p>
        </div>
      </header>

      {renderBody()}

      {canClearAll ? (
        <section className="uth-clearall" aria-label="Clear all history">
          {clearOpen ? (
            <div className="uth-clearall-panel" role="group">
              <p>
                This permanently deletes <strong>all</strong> of your history. Type{' '}
                <strong>{CLEAR_ALL_CONFIRM_WORD}</strong> to confirm.
              </p>
              <div className="uth-confirm">
                <input
                  type="text"
                  className="uth-clearall-input"
                  value={clearInput}
                  onChange={(e) => setClearInput(e.target.value)}
                  aria-label={`Type ${CLEAR_ALL_CONFIRM_WORD} to confirm`}
                  autoFocus
                />
                <button
                  type="button"
                  className="uth-btn uth-btn-danger"
                  onClick={() => void confirmClearAll()}
                  disabled={clearInput !== CLEAR_ALL_CONFIRM_WORD || clearBusy}
                >
                  {clearBusy ? <span className="uth-spinner" aria-hidden="true" /> : null}
                  Delete everything
                </button>
                <button
                  type="button"
                  className="uth-btn"
                  onClick={() => {
                    setClearOpen(false);
                    setClearInput('');
                    setClearError(false);
                  }}
                  disabled={clearBusy}
                >
                  Cancel
                </button>
              </div>
              {clearError ? (
                <p className="uth-status-danger" role="alert">
                  Couldn’t clear your history. Please try again.
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="uth-btn uth-btn-danger"
              onClick={() => setClearOpen(true)}
            >
              Clear all history
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
