// The real `HistoryApi` — talks to the §5 REST surface over `fetch`. Two ports keep it testable and
// keyless: a `TokenProvider` (supplies the Clerk bearer; real wiring lands at the Phase-3 gate) and
// an injectable `FetchFn` (defaults to the global `fetch`, replaced by a fake in unit tests so we
// assert request shaping — method, path, query encoding, Authorization header — without a network).
//
// Privacy: this module never logs a response body or `HistoryItem.text`; failures are mapped to a
// `HistoryApiError` carrying only a status and a short safe message.
import type { HistoryItem } from '@undertone/shared';
import {
  HistoryApiError,
  type HistoryApi,
  type HistoryApiErrorKind,
  type HistoryListParams,
  type HistoryListResult,
} from './history-api';

/** Supplies the bearer token for the REST calls. Reconnect logic/refresh lives behind this port. */
export interface TokenProvider {
  /** Resolve a valid bearer token. May refresh internally; rejects if none can be obtained. */
  getToken(): Promise<string>;
}

/** The subset of the WHATWG `fetch` signature this module needs; lets tests inject a fake. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface RestHistoryApiDeps {
  /** API origin, e.g. "https://api.undertone.app" — no trailing slash required. */
  baseUrl: string;
  tokenProvider: TokenProvider;
  /** Defaults to the global `fetch`; injected as a fake in tests. */
  fetch?: FetchFn;
}

/** Map an HTTP status to an error kind + retryability. */
function kindForStatus(status: number): HistoryApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 404) return 'notFound';
  if (status >= 500) return 'server';
  return 'unknown';
}

export class RestHistoryApi implements HistoryApi {
  private readonly baseUrl: string;
  private readonly tokenProvider: TokenProvider;
  private readonly fetchFn: FetchFn;

  constructor(deps: RestHistoryApiDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.tokenProvider = deps.tokenProvider;
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Build the querystring for GET /v1/history, omitting empty params (matches §5 semantics). */
  private listUrl(params: HistoryListParams): string {
    const qs = new URLSearchParams();
    if (params.q !== undefined && params.q !== '') qs.set('q', params.q);
    if (params.cursor !== undefined && params.cursor !== '') qs.set('cursor', params.cursor);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString();
    return `${this.baseUrl}/v1/history${suffix ? `?${suffix}` : ''}`;
  }

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.tokenProvider.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  /** Run a request, mapping transport failures and non-2xx statuses to HistoryApiError. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch {
      // Network-level failure (offline, DNS, TLS). No body to leak.
      throw new HistoryApiError('network', 'could not reach the history service');
    }
    if (!res.ok) {
      const kind = kindForStatus(res.status);
      throw new HistoryApiError(kind, `history request failed (${res.status})`, {
        status: res.status,
      });
    }
    return res;
  }

  async list(params: HistoryListParams = {}): Promise<HistoryListResult> {
    const res = await this.send(this.listUrl(params), {
      method: 'GET',
      headers: { ...(await this.authHeader()) },
    });
    const body = (await res.json()) as { items: HistoryItem[]; nextCursor?: string };
    return body.nextCursor === undefined
      ? { items: body.items }
      : { items: body.items, nextCursor: body.nextCursor };
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.send(`${this.baseUrl}/v1/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...(await this.authHeader()) },
    });
    return { ok: true };
  }

  async removeAll(): Promise<{ ok: true; deleted: number }> {
    const res = await this.send(`${this.baseUrl}/v1/history`, {
      method: 'DELETE',
      headers: { ...(await this.authHeader()) },
    });
    const body = (await res.json()) as { ok: true; deleted: number };
    return { ok: true, deleted: body.deleted };
  }
}
