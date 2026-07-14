// In-memory, deterministic `HistoryApi` for tests and keyless previews. It reproduces the server's
// observable contract (CONTRACTS.md §5/§7) closely enough to drive the view honestly:
//   - exact-word (AND) search over the transcript text,
//   - opaque cursor pagination ordered by (createdAt desc, id desc),
//   - `remove` throws `notFound` for unknown ids, `removeAll` reports the count.
// It is NOT a security model (no encryption, no auth) — it is a faithful behavioural double.
import type { HistoryItem } from '@undertone/shared';
import {
  HistoryApiError,
  type HistoryApi,
  type HistoryListParams,
  type HistoryListResult,
} from './history-api';

/** Default page size when a caller omits `limit`. Kept small so pagination is easy to exercise. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Normalize text into exact words: lowercase, keep alphanumerics + apostrophes. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** True iff every query word appears as an exact word in `text` (AND semantics, §5/§7). */
export function matchesQuery(text: string, q: string): boolean {
  const needles = wordsOf(q);
  if (needles.length === 0) return true;
  const haystack = new Set(wordsOf(text));
  return needles.every((w) => haystack.has(w));
}

/** Order key: newest first, ties broken by id descending for a total, stable order. */
function isBefore(a: HistoryItem, b: HistoryItem): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

function encodeCursor(item: HistoryItem): string {
  // btoa exists in jsdom + browser (renderer) contexts; encode (createdAt,id) opaquely like §5.
  return btoa(`${item.createdAt}|${item.id}`);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

export interface FakeHistoryApiOptions {
  /** Optional per-call latency (ms) so tests can exercise loading states with fake timers. */
  delayMs?: number;
  /** When set, `list` rejects with this error (to exercise the view's error state). */
  failList?: HistoryApiError;
}

/**
 * Deterministic in-memory {@link HistoryApi}. Seed with items (any order); it sorts them into the
 * canonical newest-first order on every read, so callers never depend on insertion order.
 */
export class FakeHistoryApi implements HistoryApi {
  private items: HistoryItem[];
  private readonly delayMs: number;
  private failList: HistoryApiError | undefined;

  constructor(seed: HistoryItem[] = [], opts: FakeHistoryApiOptions = {}) {
    this.items = [...seed];
    this.delayMs = opts.delayMs ?? 0;
    this.failList = opts.failList;
  }

  /** Replace the backing set (test convenience). */
  seed(items: HistoryItem[]): void {
    this.items = [...items];
  }

  /** Arm/disarm a forced `list` failure (test convenience). */
  setFailList(err: HistoryApiError | undefined): void {
    this.failList = err;
  }

  /** Current item count, for assertions. */
  get size(): number {
    return this.items.length;
  }

  private async settle(): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  async list(params: HistoryListParams = {}): Promise<HistoryListResult> {
    await this.settle();
    if (this.failList) throw this.failList;

    const limit = clampLimit(params.limit);
    const q = params.q ?? '';
    const ordered = [...this.items].sort((a, b) => (isBefore(a, b) ? -1 : 1));
    const filtered = q ? ordered.filter((it) => matchesQuery(it.text, q)) : ordered;

    // Cursor points at the LAST item of the previous page; resume strictly after it.
    let start = 0;
    if (params.cursor !== undefined && params.cursor !== '') {
      const decoded = decodeCursorId(params.cursor);
      if (decoded !== null) {
        const idx = filtered.findIndex((it) => it.id === decoded);
        start = idx === -1 ? filtered.length : idx + 1;
      }
    }

    const page = filtered.slice(start, start + limit);
    const hasMore = start + limit < filtered.length;
    const last = page[page.length - 1];
    return hasMore && last !== undefined
      ? { items: page, nextCursor: encodeCursor(last) }
      : { items: page };
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.settle();
    const before = this.items.length;
    this.items = this.items.filter((it) => it.id !== id);
    if (this.items.length === before) {
      throw new HistoryApiError('notFound', 'history item not found', { status: 404 });
    }
    return { ok: true };
  }

  async removeAll(): Promise<{ ok: true; deleted: number }> {
    await this.settle();
    const deleted = this.items.length;
    this.items = [];
    return { ok: true, deleted };
  }
}

/** Decode the opaque cursor back to its item id; null if malformed. */
function decodeCursorId(cursor: string): string | null {
  try {
    const decoded = atob(cursor);
    const sep = decoded.indexOf('|');
    if (sep === -1) return null;
    const id = decoded.slice(sep + 1);
    return id === '' ? null : id;
  } catch {
    return null;
  }
}
