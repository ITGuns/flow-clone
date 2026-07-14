// The `HistoryApi` port — the seam between the history view and the server-stored transcript
// history (CONTRACTS.md §5). Everything above this interface is unit-testable with a fake on any
// OS, keyless. Two implementations live beside it: `FakeHistoryApi` (in-memory, deterministic, for
// tests + storybook-style previews) and `RestHistoryApi` (fetch against the §5 REST surface, wired
// to a real bearer at the Phase-3 gate). The port mirrors §5 byte-for-byte:
//   GET    /v1/history?q=&cursor=&limit=  → { items: HistoryItem[], nextCursor? }
//   DELETE /v1/history/:id                → { ok: true }
//   DELETE /v1/history                    → { ok: true, deleted: number }
//
// No method ever accepts or returns transcript content outside the `HistoryItem.text` field, and no
// implementation may log that field (privacy posture, guide §3).
import type { HistoryItem } from '@undertone/shared';

/** Query params for a history page. All optional; `q` is exact-word (AND) search per §5/§7. */
export interface HistoryListParams {
  /** Exact-word search string; multiple words are ANDed. Empty/absent → unfiltered. */
  q?: string;
  /** Opaque cursor from a previous page's `nextCursor`. Absent → first page. */
  cursor?: string;
  /** Page size hint; the server clamps to its own bounds. */
  limit?: number;
}

/** One page of history plus the opaque cursor for the next page (absent on the last page). */
export interface HistoryListResult {
  items: HistoryItem[];
  nextCursor?: string;
}

/**
 * The history data port. Implementations must be side-effect-honest: `list` never mutates, `remove`
 * and `removeAll` are the only mutations, and failures surface as thrown {@link HistoryApiError}s so
 * the view can render an honest, retryable error state.
 */
export interface HistoryApi {
  /** Fetch one page. Throws {@link HistoryApiError} on transport/auth failure. */
  list(params?: HistoryListParams): Promise<HistoryListResult>;
  /** Delete one item by id. Throws {@link HistoryApiError} (`notFound`) if it is not the owner's. */
  remove(id: string): Promise<{ ok: true }>;
  /** Delete every item for the owner; resolves with the number deleted. */
  removeAll(): Promise<{ ok: true; deleted: number }>;
}

/** Why a {@link HistoryApiError} fired — drives the view's copy and whether a Retry is offered. */
export type HistoryApiErrorKind = 'auth' | 'notFound' | 'network' | 'server' | 'unknown';

/**
 * The single error type every {@link HistoryApi} throws. Carries a `kind` (for branching) and a
 * `retryable` flag (for the view's Retry affordance) — never any transcript content, and never the
 * raw server body verbatim beyond a short safe message.
 */
export class HistoryApiError extends Error {
  readonly kind: HistoryApiErrorKind;
  readonly retryable: boolean;
  /** HTTP status when the failure came from a response; undefined for transport-level failures. */
  readonly status?: number;

  constructor(kind: HistoryApiErrorKind, message: string, opts?: { status?: number }) {
    super(message);
    this.name = 'HistoryApiError';
    this.kind = kind;
    this.retryable = kind === 'network' || kind === 'server' || kind === 'unknown';
    if (opts?.status !== undefined) this.status = opts.status;
  }
}
