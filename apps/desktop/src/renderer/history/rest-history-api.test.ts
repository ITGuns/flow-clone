import { describe, it, expect } from 'vitest';
import { RestHistoryApi, HistoryApiError, type FetchFn, type TokenProvider } from '../history';
import { makeSeries } from './test-fixtures';

/** Records every request and replays a queue of canned responses. */
function recorder(responses: Response[]): {
  fetch: FetchFn;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fetch: FetchFn = (url, init) => {
    calls.push(init ? { url, init } : { url });
    const res = responses[i++];
    if (!res) throw new Error('no queued response');
    return Promise.resolve(res);
  };
  return { fetch, calls };
}

const token: TokenProvider = { getToken: () => Promise.resolve('tok-123') };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authOf(init?: RequestInit): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.['Authorization'];
}

describe('RestHistoryApi.list — request shaping', () => {
  it('GETs /v1/history with the bearer and no query when params are empty', async () => {
    const { fetch, calls } = recorder([json({ items: [] })]);
    const api = new RestHistoryApi({
      baseUrl: 'https://api.undertone.app',
      tokenProvider: token,
      fetch,
    });
    await api.list();
    expect(calls[0]?.url).toBe('https://api.undertone.app/v1/history');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(authOf(calls[0]?.init)).toBe('Bearer tok-123');
  });

  it('encodes q, cursor and limit into the querystring, omitting empties', async () => {
    const { fetch, calls } = recorder([json({ items: [] })]);
    const api = new RestHistoryApi({
      baseUrl: 'https://api.undertone.app',
      tokenProvider: token,
      fetch,
    });
    await api.list({ q: 'hello world', cursor: 'CUR==', limit: 10 });
    const url = calls[0]?.url ?? '';
    expect(url.startsWith('https://api.undertone.app/v1/history?')).toBe(true);
    expect(url).toContain('q=hello+world');
    expect(url).toContain('cursor=CUR%3D%3D');
    expect(url).toContain('limit=10');
  });

  it('omits an empty q/cursor rather than sending blank params', async () => {
    const { fetch, calls } = recorder([json({ items: [] })]);
    const api = new RestHistoryApi({
      baseUrl: 'https://api.undertone.app',
      tokenProvider: token,
      fetch,
    });
    await api.list({ q: '', cursor: '' });
    expect(calls[0]?.url).toBe('https://api.undertone.app/v1/history');
  });

  it('strips a trailing slash on baseUrl', async () => {
    const { fetch, calls } = recorder([json({ items: [] })]);
    const api = new RestHistoryApi({
      baseUrl: 'https://api.undertone.app/',
      tokenProvider: token,
      fetch,
    });
    await api.list();
    expect(calls[0]?.url).toBe('https://api.undertone.app/v1/history');
  });

  it('parses items and nextCursor, and omits nextCursor when absent', async () => {
    const items = makeSeries(2);
    const withCursor = recorder([json({ items, nextCursor: 'NEXT' })]);
    const a = new RestHistoryApi({
      baseUrl: 'https://x',
      tokenProvider: token,
      fetch: withCursor.fetch,
    });
    expect(await a.list()).toEqual({ items, nextCursor: 'NEXT' });

    const noCursor = recorder([json({ items })]);
    const b = new RestHistoryApi({
      baseUrl: 'https://x',
      tokenProvider: token,
      fetch: noCursor.fetch,
    });
    expect(await b.list()).toEqual({ items });
  });
});

describe('RestHistoryApi.remove / removeAll — request shaping', () => {
  it('DELETEs /v1/history/:id (url-encoded) with the bearer', async () => {
    const { fetch, calls } = recorder([json({ ok: true })]);
    const api = new RestHistoryApi({ baseUrl: 'https://x', tokenProvider: token, fetch });
    const res = await api.remove('a/b id');
    expect(res).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://x/v1/history/a%2Fb%20id');
    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(authOf(calls[0]?.init)).toBe('Bearer tok-123');
  });

  it('DELETEs /v1/history and returns the deleted count', async () => {
    const { fetch, calls } = recorder([json({ ok: true, deleted: 7 })]);
    const api = new RestHistoryApi({ baseUrl: 'https://x', tokenProvider: token, fetch });
    const res = await api.removeAll();
    expect(res).toEqual({ ok: true, deleted: 7 });
    expect(calls[0]?.url).toBe('https://x/v1/history');
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});

describe('RestHistoryApi — error mapping', () => {
  const cases: { status: number; kind: string; retryable: boolean }[] = [
    { status: 401, kind: 'auth', retryable: false },
    { status: 404, kind: 'notFound', retryable: false },
    { status: 500, kind: 'server', retryable: true },
    { status: 418, kind: 'unknown', retryable: true },
  ];
  for (const c of cases) {
    it(`maps HTTP ${c.status} → ${c.kind} (retryable=${c.retryable})`, async () => {
      const { fetch } = recorder([json({ t: 'error' }, c.status)]);
      const api = new RestHistoryApi({ baseUrl: 'https://x', tokenProvider: token, fetch });
      await expect(api.list()).rejects.toMatchObject({
        kind: c.kind,
        retryable: c.retryable,
        status: c.status,
      });
    });
  }

  it('maps a transport rejection to a retryable network error (no body leaked)', async () => {
    const fetch: FetchFn = () => Promise.reject(new Error('ECONNREFUSED at 10.0.0.1'));
    const api = new RestHistoryApi({ baseUrl: 'https://x', tokenProvider: token, fetch });
    const err = await api.list().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HistoryApiError);
    expect((err as HistoryApiError).kind).toBe('network');
    expect((err as HistoryApiError).retryable).toBe(true);
    // the raw transport message must not surface
    expect((err as HistoryApiError).message).not.toContain('ECONNREFUSED');
  });
});
