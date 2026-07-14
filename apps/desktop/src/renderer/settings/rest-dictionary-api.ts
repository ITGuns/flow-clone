// Production DictionaryApi over the CONTRACTS.md §5 REST endpoints. `fetch` and the bearer token are
// injected so request shaping + status→error mapping unit-test without a live server (and without
// coupling to the DOM `fetch` global). The token is read via a getter so a refreshed Clerk token is
// always picked up on the next call.
import type { DictionaryEntry } from '@undertone/shared';
import {
  DictionaryApiError,
  type DictionaryApi,
  type DictionaryCreateInput,
  type DictionaryErrorKind,
  type DictionaryUpdateInput,
} from './dictionary-api';

/** Minimal fetch surface — decoupled from the DOM `fetch`/`Response` types for easy faking. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface RestDictionaryApiOptions {
  /** API origin, e.g. "https://api.undertone.app" (no trailing slash needed). */
  baseUrl: string;
  fetch: FetchLike;
  /** Returns the current bearer token, or null when unauthenticated. */
  getToken?: () => string | null;
}

function statusToKind(status: number): DictionaryErrorKind {
  switch (status) {
    case 400:
      return 'bad-request';
    case 401:
      return 'unauthorized';
    case 404:
      return 'not-found';
    case 409:
      return 'duplicate';
    case 422:
      return 'cap';
    default:
      return 'unknown';
  }
}

export class RestDictionaryApi implements DictionaryApi {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly getToken: () => string | null;

  constructor(options: RestDictionaryApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch;
    this.getToken = options.getToken ?? (() => null);
  }

  async list(): Promise<DictionaryEntry[]> {
    const res = await this.request('GET', '/v1/dictionary');
    const body = (await this.readJson(res)) as { entries?: DictionaryEntry[] };
    return body.entries ?? [];
  }

  async create(input: DictionaryCreateInput): Promise<DictionaryEntry> {
    const res = await this.request('POST', '/v1/dictionary', {
      phrase: input.phrase,
      ...(input.soundsLike ? { soundsLike: input.soundsLike } : {}),
    });
    return (await this.readJson(res)) as DictionaryEntry;
  }

  async update(id: string, patch: DictionaryUpdateInput): Promise<DictionaryEntry> {
    const res = await this.request('PATCH', `/v1/dictionary/${encodeURIComponent(id)}`, patch);
    return (await this.readJson(res)) as DictionaryEntry;
  }

  async remove(id: string): Promise<void> {
    const res = await this.request('DELETE', `/v1/dictionary/${encodeURIComponent(id)}`);
    if (!res.ok) throw this.toError(res);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<FetchResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = this.getToken();
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const init: FetchInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    try {
      return await this.fetch(`${this.baseUrl}${path}`, init);
    } catch {
      throw new DictionaryApiError('network', 'request failed');
    }
  }

  private async readJson(res: FetchResponse): Promise<unknown> {
    if (!res.ok) throw this.toError(res);
    try {
      return await res.json();
    } catch {
      throw new DictionaryApiError('network', 'invalid response body');
    }
  }

  private toError(res: FetchResponse): DictionaryApiError {
    return new DictionaryApiError(statusToKind(res.status), `request failed (${res.status})`, res.status);
  }
}
