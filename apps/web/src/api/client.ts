// REST client for the §5 surface the dashboard needs: the WS session token, GET /v1/me (usage +
// plan), and the history list/delete endpoints. `fetch` is injectable so request shaping is unit
// tested without a network. Auth: a §5 session token is minted via POST /v1/session/token (mock
// mode authenticates automatically) and sent as the bearer on the authenticated reads. In real
// mode those reads expect a Clerk bearer — wiring Clerk into the web app is out of scope for web v1
// (DECISIONS D-023); the dashboard targets mock mode end-to-end.
import type { HistoryItem, Register } from '@undertone/shared';

export type Plan = 'free' | 'pro';

/** GET /v1/me 200 body (CONTRACTS §5). */
export interface MeResponse {
  userId: string;
  email: string;
  plan: Plan;
  trialEndsAt: string | null;
  usage: { wordsThisWeek: number; limit: number };
}

export interface HistoryListParams {
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface HistoryListResult {
  items: HistoryItem[];
  nextCursor?: string;
}

export type ApiErrorKind = 'auth' | 'notFound' | 'server' | 'network' | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface WebApiClientOptions {
  /** API origin, e.g. "http://localhost:8080" — trailing slash tolerated. */
  baseUrl: string;
  /** Defaults to the global `fetch`; injected as a fake in tests. */
  fetch?: FetchFn;
}

/** The client surface the dashboard depends on — a fake implements this in `.tsx` tests. */
export interface WebApi {
  /** Mint a fresh WS session token (§4.1 — reconnects always fetch a fresh one). */
  getSessionToken(): Promise<string>;
  getMe(): Promise<MeResponse>;
  listHistory(params?: HistoryListParams): Promise<HistoryListResult>;
  deleteHistory(id: string): Promise<void>;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 404) return 'notFound';
  if (status >= 500) return 'server';
  return 'unknown';
}

export class RestApiClient implements WebApi {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private token: string | null = null;

  constructor(options: WebApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async getSessionToken(): Promise<string> {
    const res = await this.request(`${this.baseUrl}/v1/session/token`, { method: 'POST' });
    const body = (await res.json()) as { token: string; expiresAt: string };
    this.token = body.token;
    return body.token;
  }

  async getMe(): Promise<MeResponse> {
    const res = await this.authed(`${this.baseUrl}/v1/me`, { method: 'GET' });
    return (await res.json()) as MeResponse;
  }

  async listHistory(params: HistoryListParams = {}): Promise<HistoryListResult> {
    const res = await this.authed(this.historyUrl(params), { method: 'GET' });
    const body = (await res.json()) as { items: HistoryItem[]; nextCursor?: string };
    return body.nextCursor === undefined
      ? { items: body.items }
      : { items: body.items, nextCursor: body.nextCursor };
  }

  async deleteHistory(id: string): Promise<void> {
    await this.authed(`${this.baseUrl}/v1/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  private historyUrl(params: HistoryListParams): string {
    const qs = new URLSearchParams();
    if (params.q !== undefined && params.q !== '') qs.set('q', params.q);
    if (params.cursor !== undefined && params.cursor !== '') qs.set('cursor', params.cursor);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString();
    return `${this.baseUrl}/v1/history${suffix ? `?${suffix}` : ''}`;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.getSessionToken();
  }

  /** Authenticated request with a single 401 refresh-and-retry. */
  private async authed(url: string, init: RequestInit): Promise<Response> {
    const token = await this.ensureToken();
    const first = await this.request(url, withBearer(init, token), true);
    if (first.ok) return first;
    if (first.status === 401) {
      this.token = null;
      const fresh = await this.ensureToken();
      return this.request(url, withBearer(init, fresh));
    }
    throw new ApiError(
      kindForStatus(first.status),
      `request failed (${first.status})`,
      first.status,
    );
  }

  /** Run a request, mapping transport failures to ApiError. `allowUnauthorized` defers 401 mapping. */
  private async request(
    url: string,
    init: RequestInit,
    allowUnauthorized = false,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch {
      throw new ApiError('network', 'could not reach the service');
    }
    if (!res.ok && !(allowUnauthorized && res.status === 401)) {
      throw new ApiError(kindForStatus(res.status), `request failed (${res.status})`, res.status);
    }
    return res;
  }
}

function withBearer(init: RequestInit, token: string): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } };
}

/** Re-exported for the history panel's rendering. */
export type { HistoryItem, Register };
