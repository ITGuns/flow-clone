import { describe, it, expect } from 'vitest';
import { RestDictionaryApi, type FetchInit, type FetchResponse } from './rest-dictionary-api';
import { DictionaryApiError } from './dictionary-api';

interface Recorded {
  url: string;
  init: FetchInit;
}

function fetchReturning(
  response: Partial<FetchResponse> & { status: number; ok: boolean; jsonValue?: unknown },
  sink: Recorded[],
) {
  return (url: string, init: FetchInit): Promise<FetchResponse> => {
    sink.push({ url, init });
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.jsonValue),
    });
  };
}

describe('RestDictionaryApi — request shaping', () => {
  it('GET /v1/dictionary and unwraps { entries }', async () => {
    const calls: Recorded[] = [];
    const api = new RestDictionaryApi({
      baseUrl: 'https://api.undertone.app/',
      fetch: fetchReturning(
        { ok: true, status: 200, jsonValue: { entries: [{ id: 'x', phrase: 'K8s', soundsLike: [], createdAt: '' }] } },
        calls,
      ),
    });
    const entries = await api.list();
    expect(entries).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.undertone.app/v1/dictionary'); // trailing slash trimmed
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('POST /v1/dictionary sends phrase + soundsLike JSON with content-type', async () => {
    const calls: Recorded[] = [];
    const api = new RestDictionaryApi({
      baseUrl: 'https://api.undertone.app',
      fetch: fetchReturning({ ok: true, status: 200, jsonValue: { id: 'n', phrase: 'Kubernetes', soundsLike: ['cooper netties'], createdAt: '' } }, calls),
      getToken: () => 'jwt-123',
    });
    const created = await api.create({ phrase: 'Kubernetes', soundsLike: ['cooper netties'] });
    expect(created.phrase).toBe('Kubernetes');
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.undertone.app/v1/dictionary');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers.authorization).toBe('Bearer jwt-123');
    expect(JSON.parse(init.body!)).toEqual({ phrase: 'Kubernetes', soundsLike: ['cooper netties'] });
  });

  it('omits soundsLike from the body when not provided', async () => {
    const calls: Recorded[] = [];
    const api = new RestDictionaryApi({
      baseUrl: 'https://api.undertone.app',
      fetch: fetchReturning({ ok: true, status: 200, jsonValue: {} }, calls),
    });
    await api.create({ phrase: 'Solo' });
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({ phrase: 'Solo' });
    expect(calls[0]!.init.headers.authorization).toBeUndefined(); // no token → no auth header
  });

  it('PATCH /v1/dictionary/:id encodes the id and sends the patch', async () => {
    const calls: Recorded[] = [];
    const api = new RestDictionaryApi({
      baseUrl: 'https://api.undertone.app',
      fetch: fetchReturning({ ok: true, status: 200, jsonValue: { id: 'a b', phrase: 'X', soundsLike: [], createdAt: '' } }, calls),
    });
    await api.update('a b', { phrase: 'X' });
    expect(calls[0]!.url).toBe('https://api.undertone.app/v1/dictionary/a%20b');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({ phrase: 'X' });
  });

  it('DELETE /v1/dictionary/:id resolves on ok', async () => {
    const calls: Recorded[] = [];
    const api = new RestDictionaryApi({
      baseUrl: 'https://api.undertone.app',
      fetch: fetchReturning({ ok: true, status: 200, jsonValue: { ok: true } }, calls),
    });
    await expect(api.remove('id-1')).resolves.toBeUndefined();
    expect(calls[0]!.init.method).toBe('DELETE');
  });
});

describe('RestDictionaryApi — status → error mapping', () => {
  const cases: Array<[number, string]> = [
    [400, 'bad-request'],
    [401, 'unauthorized'],
    [404, 'not-found'],
    [409, 'duplicate'],
    [422, 'cap'],
    [500, 'unknown'],
  ];
  for (const [status, kind] of cases) {
    it(`maps ${status} → ${kind}`, async () => {
      const api = new RestDictionaryApi({
        baseUrl: 'https://api.undertone.app',
        fetch: () => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) }),
      });
      await expect(api.create({ phrase: 'p' })).rejects.toMatchObject({ kind });
    });
  }

  it('maps a rejected fetch (transport failure) → network', async () => {
    const api = new RestDictionaryApi({
      baseUrl: 'https://api.undertone.app',
      fetch: () => Promise.reject(new Error('offline')),
    });
    const err = await api.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DictionaryApiError);
    expect((err as DictionaryApiError).kind).toBe('network');
  });
});
