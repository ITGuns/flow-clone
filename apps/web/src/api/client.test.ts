import { describe, it, expect } from 'vitest';
import { ApiError, RestApiClient, type FetchFn } from './client';

const BASE = 'http://localhost:8080';

interface Call {
  url: string;
  method: string;
  auth: string | null;
}

function recorder(handler: (call: Call) => Response | Promise<Response>): {
  fetch: FetchFn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    const headers = new Headers(init?.headers ?? {});
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      auth: headers.get('Authorization'),
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('RestApiClient — session token', () => {
  it('POSTs /v1/session/token and returns the token', async () => {
    const { fetch, calls } = recorder(() => json({ token: 'tok-1', expiresAt: 'later' }));
    const client = new RestApiClient({ baseUrl: `${BASE}/`, fetch });
    expect(await client.getSessionToken()).toBe('tok-1');
    expect(calls[0]).toMatchObject({ url: `${BASE}/v1/session/token`, method: 'POST' });
  });
});

describe('RestApiClient — GET /v1/me', () => {
  it('sends the bearer token and parses the usage/plan body', async () => {
    const me = {
      userId: 'user_mock',
      email: 'mock@undertone.dev',
      plan: 'pro' as const,
      trialEndsAt: null,
      usage: { wordsThisWeek: 120, limit: 50000 },
    };
    const { fetch, calls } = recorder((call) =>
      call.url.endsWith('/session/token') ? json({ token: 'tok-9', expiresAt: 'x' }) : json(me),
    );
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    expect(await client.getMe()).toEqual(me);
    const meCall = calls.find((c) => c.url.endsWith('/v1/me'));
    expect(meCall?.auth).toBe('Bearer tok-9');
  });
});

describe('RestApiClient — history', () => {
  it('builds the query string, omitting blank params', async () => {
    const { fetch, calls } = recorder((call) =>
      call.url.includes('/session/token')
        ? json({ token: 't', expiresAt: 'x' })
        : json({ items: [], nextCursor: 'CURSOR' }),
    );
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    const result = await client.listHistory({ q: 'deck', cursor: '', limit: 20 });
    expect(result.nextCursor).toBe('CURSOR');
    const listCall = calls.find((c) => c.url.includes('/v1/history'));
    expect(listCall?.url).toBe(`${BASE}/v1/history?q=deck&limit=20`);
  });

  it('DELETEs a single item by encoded id', async () => {
    const { fetch, calls } = recorder((call) =>
      call.url.includes('/session/token')
        ? json({ token: 't', expiresAt: 'x' })
        : json({ ok: true }),
    );
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    await client.deleteHistory('a b/c');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe(`${BASE}/v1/history/a%20b%2Fc`);
  });
});

describe('RestApiClient — auth refresh + error mapping', () => {
  it('refreshes the token once on a 401 and retries', async () => {
    let tokenN = 0;
    let meCalls = 0;
    const { fetch } = recorder((call) => {
      if (call.url.endsWith('/session/token')) {
        tokenN += 1;
        return json({ token: `tok-${tokenN}`, expiresAt: 'x' });
      }
      meCalls += 1;
      return meCalls === 1 ? json({}, 401) : json({ email: 'ok' });
    });
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    const res = (await client.getMe()) as unknown as { email: string };
    expect(res.email).toBe('ok');
    expect(tokenN).toBe(2); // initial + one refresh
    expect(meCalls).toBe(2);
  });

  it('maps a 404 to ApiError(notFound)', async () => {
    const { fetch } = recorder((call) =>
      call.url.includes('/session/token') ? json({ token: 't', expiresAt: 'x' }) : json({}, 404),
    );
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    await expect(client.deleteHistory('missing')).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('maps a transport failure to ApiError(network)', async () => {
    const fetch: FetchFn = () => Promise.reject(new Error('offline'));
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    await expect(client.getSessionToken()).rejects.toBeInstanceOf(ApiError);
    await expect(client.getSessionToken()).rejects.toMatchObject({ kind: 'network' });
  });
});
