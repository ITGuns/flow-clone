// One history row: the formatted text, an app-name + register badge, a relative timestamp, a word
// count, and a per-item delete with a two-step inline confirm. Delete failures render an honest,
// retryable inline error — the row is never removed unless the API call succeeded.
//
// Privacy: the transcript text is rendered to the DOM (it is the user's own content, shown to them)
// but never passed to console/log and never placed in an aria-label.
import { useId, useState, type ReactElement } from 'react';
import type { HistoryItem } from '@undertone/shared';
import { relativeTime, absoluteTime } from './relative-time';

export interface HistoryItemRowProps {
  item: HistoryItem;
  /** Injected for deterministic relative-time rendering in tests. */
  now?: Date;
  /** Delete this item; resolves on success (row is then removed by the parent), rejects on failure. */
  onDelete(id: string): Promise<void>;
}

type RowMode = 'idle' | 'confirming' | 'deleting' | 'error';

export function HistoryItemRow({ item, now, onDelete }: HistoryItemRowProps): ReactElement {
  const [mode, setMode] = useState<RowMode>('idle');
  const textId = useId();

  async function doDelete(): Promise<void> {
    setMode('deleting');
    try {
      await onDelete(item.id);
      // On success the parent unmounts this row; no further state change needed.
    } catch {
      setMode('error');
    }
  }

  const wordLabel = `${item.wordCount} ${item.wordCount === 1 ? 'word' : 'words'}`;

  return (
    <li className="uth-row" aria-labelledby={textId}>
      <p id={textId} className="uth-text">
        {item.text}
      </p>
      <div className="uth-meta">
        <span className="uth-badge">{item.register}</span>
        <span>{item.appName}</span>
        <span>·</span>
        <span title={absoluteTime(item.createdAt)}>{relativeTime(item.createdAt, now)}</span>
        <span>·</span>
        <span>{wordLabel}</span>
        <span className="uth-meta-spacer" />

        {mode === 'idle' ? (
          <button
            type="button"
            className="uth-btn uth-btn-ghost uth-btn-sm"
            onClick={() => setMode('confirming')}
            aria-label="Delete this dictation"
          >
            Delete
          </button>
        ) : null}

        {mode === 'confirming' ? (
          <span className="uth-confirm">
            <span className="uth-confirm-q">Delete this?</span>
            <button
              type="button"
              className="uth-btn uth-btn-danger uth-btn-sm"
              onClick={() => void doDelete()}
              autoFocus
            >
              Delete
            </button>
            <button
              type="button"
              className="uth-btn uth-btn-sm"
              onClick={() => setMode('idle')}
            >
              Cancel
            </button>
          </span>
        ) : null}

        {mode === 'deleting' ? (
          <span className="uth-confirm" role="status">
            <span className="uth-spinner" aria-hidden="true" />
            Deleting…
          </span>
        ) : null}

        {mode === 'error' ? (
          <span className="uth-confirm" role="alert">
            <span className="uth-status-danger">Couldn’t delete.</span>
            <button
              type="button"
              className="uth-btn uth-btn-danger uth-btn-sm"
              onClick={() => void doDelete()}
            >
              Try again
            </button>
            <button
              type="button"
              className="uth-btn uth-btn-sm"
              onClick={() => setMode('idle')}
            >
              Cancel
            </button>
          </span>
        ) : null}
      </div>
    </li>
  );
}
