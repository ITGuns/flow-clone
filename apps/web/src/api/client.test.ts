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

describe('RestApiClient — POST /v1/billing/checkout', () => {
  it('POSTs the interval with a bearer token and returns the checkout url', async () => {
    const bodies: string[] = [];
    const { fetch, calls } = recorder((call) => {
      if (call.url.endsWith('/session/token')) return json({ token: 'tok-3', expiresAt: 'x' });
      return json({ url: 'https://checkout.stripe.test/session/1' });
    });
    // Capture the request body separately (the recorder only records url/method/auth).
    const wrapped: FetchFn = async (url, init) => {
      if (typeof init?.body === 'string' && String(url).includes('/billing/checkout')) {
        bodies.push(init.body);
      }
      return fetch(url, init);
    };
    const client = new RestApiClient({ baseUrl: BASE, fetch: wrapped });
    const result = await client.createCheckout('yearly');
    expect(result).toEqual({ url: 'https://checkout.stripe.test/session/1' });
    const checkoutCall = calls.find((c) => c.url.endsWith('/v1/billing/checkout'));
    expect(checkoutCall?.method).toBe('POST');
    expect(checkoutCall?.auth).toBe('Bearer tok-3');
    expect(bodies).toEqual([JSON.stringify({ interval: 'yearly' })]);
  });

  it('maps a 401 (after refresh also fails) to ApiError(auth)', async () => {
    const { fetch } = recorder((call) =>
      call.url.endsWith('/session/token') ? json({ token: 't', expiresAt: 'x' }) : json({}, 401),
    );
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    await expect(client.createCheckout('monthly')).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('RestApiClient — POST /v1/format', () => {
  it('POSTs the transcript + appContext with a bearer token and returns the formatted result', async () => {
    const bodies: string[] = [];
    const result = {
      text: 'Hello world.',
      wordCount: 2,
      commandsApplied: ['period'],
      usage: { wordsThisWeek: 42, limit: 50000 },
      exceeded: false,
    };
    const { fetch, calls } = recorder((call) =>
      call.url.endsWith('/session/token') ? json({ token: 'tok-7', expiresAt: 'x' }) : json(result),
    );
    const wrapped: FetchFn = async (url, init) => {
      if (typeof init?.body === 'string' && String(url).includes('/v1/format')) {
        bodies.push(init.body);
      }
      return fetch(url, init);
    };
    const client = new RestApiClient({ baseUrl: BASE, fetch: wrapped });
    const appContext = {
      bundleId: 'web.dashboard',
      appName: 'Undertone Web',
      windowTitle: '',
      register: 'email' as const,
    };
    const res = await client.formatTranscript('hello world period', appContext);
    expect(res).toEqual(result);
    const call = calls.find((c) => c.url.endsWith('/v1/format'));
    expect(call?.method).toBe('POST');
    expect(call?.auth).toBe('Bearer tok-7');
    expect(bodies).toEqual([JSON.stringify({ transcript: 'hello world period', appContext })]);
  });
});

describe('RestApiClient — GET /healthz', () => {
  it('reads the unauthenticated health body (no bearer)', async () => {
    const { fetch, calls } = recorder(() => json({ ok: true, mock: true }));
    const client = new RestApiClient({ baseUrl: BASE, fetch });
    expect(await client.getHealth()).toEqual({ ok: true, mock: true });
    const call = calls.find((c) => c.url.endsWith('/healthz'));
    expect(call?.method).toBe('GET');
    expect(call?.auth).toBeNull();
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
