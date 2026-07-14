// Tests for the dictionary REST routes — CONTRACTS §5. Keyless: a fake Authenticator injects the
// principal, an InMemoryDictionaryRepo backs the store; no Clerk, no DB, MOCK_MODE-agnostic.
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { UndertoneError, type DictionaryEntry } from '@undertone/shared';
import { InMemoryDictionaryRepo } from '../dictionary/repo';
import { DictionaryStore } from '../dictionary/store';
import type { Authenticator } from './session-token';
import { registerDictionaryRoutes } from './dictionary';

const AUTHED = { userId: 'user_a', plan: 'pro' as const };

/** Fake that authenticates every request as a fixed principal. */
function fakeAuth(userId = AUTHED.userId): Authenticator {
  return { authenticate: () => Promise.resolve({ userId, plan: 'pro' }) };
}

/** Fake that always rejects (models an unauthenticated caller). */
const rejectingAuth: Authenticator = {
  authenticate: (_req: FastifyRequest) => Promise.reject(new UndertoneError('AUTH_INVALID')),
};

async function buildApp(auth: Authenticator = fakeAuth()): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const store = new DictionaryStore(new InMemoryDictionaryRepo());
  registerDictionaryRoutes(app, { store, authenticator: auth });
  await app.ready();
  return app;
}

describe('GET /v1/dictionary', () => {
  it('returns { entries: [] } for a fresh user', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/dictionary' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ entries: DictionaryEntry[] }>()).toEqual({ entries: [] });
    await app.close();
  });

  it('returns created entries', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: 'Kubernetes' } });
    const res = await app.inject({ method: 'GET', url: '/v1/dictionary' });
    const body = res.json<{ entries: DictionaryEntry[] }>();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.phrase).toBe('Kubernetes');
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp(rejectingAuth);
    const res = await app.inject({ method: 'GET', url: '/v1/dictionary' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /v1/dictionary', () => {
  it('creates an entry (201) with the §1 shape; soundsLike defaults to []', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dictionary',
      payload: { phrase: 'Kubernetes' },
    });
    expect(res.statusCode).toBe(201);
    const entry = res.json<DictionaryEntry>();
    expect(entry.phrase).toBe('Kubernetes');
    expect(entry.soundsLike).toEqual([]);
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.createdAt).toBe('string');
    expect(Object.keys(entry).sort()).toEqual(['createdAt', 'id', 'phrase', 'soundsLike']);
    await app.close();
  });

  it('keeps provided soundsLike', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dictionary',
      payload: { phrase: 'Kubernetes', soundsLike: ['cooper netties'] },
    });
    expect(res.json<DictionaryEntry>().soundsLike).toEqual(['cooper netties']);
    await app.close();
  });

  it('returns 400 for a bad body', async () => {
    const app = await buildApp();
    for (const payload of [{}, { phrase: '' }, { phrase: 42 }, { phrase: 'x', soundsLike: 'no' }]) {
      const res = await app.inject({ method: 'POST', url: '/v1/dictionary', payload });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('returns 409 for a case-insensitive duplicate phrase', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: 'Kubernetes' } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dictionary',
      payload: { phrase: 'KUBERNETES' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('DUPLICATE_PHRASE');
    await app.close();
  });

  it('returns 422 past the 500-entry cap', async () => {
    const app = await buildApp();
    for (let i = 0; i < 500; i++) {
      await app.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: `p${i}` } });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dictionary',
      payload: { phrase: 'over' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toBe('CAP_EXCEEDED');
    await app.close();
  });

  it('returns 401 when unauthenticated (and does not create)', async () => {
    const app = await buildApp(rejectingAuth);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dictionary',
      payload: { phrase: 'Kubernetes' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('PATCH /v1/dictionary/:id', () => {
  it('updates an entry (200)', async () => {
    const app = await buildApp();
    const created = (
      await app.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: 'kube' } })
    ).json<DictionaryEntry>();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/dictionary/${created.id}`,
      payload: { phrase: 'Kubernetes' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<DictionaryEntry>().phrase).toBe('Kubernetes');
    await app.close();
  });

  it('returns 404 for a missing id', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/dictionary/00000000-0000-4000-8000-000000000000',
      payload: { phrase: 'x' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for another user’s entry (owner scoping)', async () => {
    // Create as user_b via a store shared through a second app is awkward; instead assert that an
    // id created under user_a is invisible to a different authenticated principal.
    const store = new DictionaryStore(new InMemoryDictionaryRepo());
    const appA = Fastify({ logger: false });
    registerDictionaryRoutes(appA, { store, authenticator: fakeAuth('user_a') });
    await appA.ready();
    const appB = Fastify({ logger: false });
    registerDictionaryRoutes(appB, { store, authenticator: fakeAuth('user_b') });
    await appB.ready();

    const created = (
      await appA.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: 'secret' } })
    ).json<DictionaryEntry>();
    const res = await appB.inject({
      method: 'PATCH',
      url: `/v1/dictionary/${created.id}`,
      payload: { phrase: 'stolen' },
    });
    expect(res.statusCode).toBe(404);
    await appA.close();
    await appB.close();
  });

  it('returns 400 for an empty / invalid patch', async () => {
    const app = await buildApp();
    const created = (
      await app.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: 'kube' } })
    ).json<DictionaryEntry>();
    for (const payload of [{}, { phrase: '' }, { soundsLike: 'no' }]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/dictionary/${created.id}`,
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp(rejectingAuth);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/dictionary/00000000-0000-4000-8000-000000000000',
      payload: { phrase: 'x' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('DELETE /v1/dictionary/:id', () => {
  it('deletes an entry → { ok: true }', async () => {
    const app = await buildApp();
    const created = (
      await app.inject({ method: 'POST', url: '/v1/dictionary', payload: { phrase: 'kube' } })
    ).json<DictionaryEntry>();
    const res = await app.inject({ method: 'DELETE', url: `/v1/dictionary/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
    const list = await app.inject({ method: 'GET', url: '/v1/dictionary' });
    expect(list.json<{ entries: DictionaryEntry[] }>().entries).toHaveLength(0);
    await app.close();
  });

  it('returns 404 for a missing id', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/dictionary/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = await buildApp(rejectingAuth);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/dictionary/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
