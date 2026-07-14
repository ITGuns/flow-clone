// History REST route tests (§5) — over a real Fastify instance with an in-memory store. Proves
// list/search/pagination shapes, owner-scoped delete (404 for non-owners), bulk delete count, and
// 401 on auth failure. Keyless, no live DB.
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { HistoryItem } from '@undertone/shared';
import { UndertoneError } from '@undertone/shared';
import { DEV_CONTENT_KEY } from '../history/crypto';
import { DEV_TOKEN_INDEX_KEY } from '../history/token-index';
import { InMemoryTranscriptRepo } from '../history/repo';
import { TranscriptStore } from '../history/store';
import { MockAuthenticator, type Authenticator } from './session-token';
import { registerHistoryRoutes } from './history';

const MOCK_USER = 'user_mock';

function build(now?: () => Date): {
  app: FastifyInstance;
  store: TranscriptStore;
  repo: InMemoryTranscriptRepo;
} {
  const repo = new InMemoryTranscriptRepo(now);
  const store = new TranscriptStore({
    repo,
    contentKey: DEV_CONTENT_KEY,
    tokenKey: DEV_TOKEN_INDEX_KEY,
  });
  const app = Fastify({ logger: false });
  registerHistoryRoutes(app, { store, authenticator: new MockAuthenticator() });
  return { app, store, repo };
}

interface ListBody {
  items: HistoryItem[];
  nextCursor?: string;
}

describe('GET /v1/history', () => {
  it("lists the mock user's transcripts newest-first", async () => {
    let t = 1_700_000_000_000;
    const { app, store } = build(() => new Date((t += 1000)));
    await store.persist({
      userId: MOCK_USER,
      text: 'first',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await store.persist({
      userId: MOCK_USER,
      text: 'second',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/v1/history' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ListBody>();
    expect(body.items.map((i) => i.text)).toEqual(['second', 'first']);
    expect(body.nextCursor).toBeUndefined();
    await app.close();
  });

  it('filters by exact-word q', async () => {
    const { app, store } = build();
    await store.persist({
      userId: MOCK_USER,
      text: 'deploy kubernetes now',
      appName: 'VS Code',
      register: 'code',
      wordCount: 3,
    });
    await store.persist({
      userId: MOCK_USER,
      text: 'lunch plans',
      appName: 'Slack',
      register: 'chat',
      wordCount: 2,
    });
    await app.ready();

    const hit = await app.inject({ method: 'GET', url: '/v1/history?q=kubernetes' });
    expect(hit.json<ListBody>().items).toHaveLength(1);
    const miss = await app.inject({ method: 'GET', url: '/v1/history?q=postgres' });
    expect(miss.json<ListBody>().items).toHaveLength(0);
    await app.close();
  });

  it('paginates via cursor and honors the limit param', async () => {
    let t = 1_700_000_000_000;
    const { app, store } = build(() => new Date((t += 1000)));
    for (let i = 0; i < 3; i++) {
      await store.persist({
        userId: MOCK_USER,
        text: `n${i}`,
        appName: 'Slack',
        register: 'chat',
        wordCount: 1,
      });
    }
    await app.ready();

    const p1 = (await app.inject({ method: 'GET', url: '/v1/history?limit=2' })).json<ListBody>();
    expect(p1.items.map((i) => i.text)).toEqual(['n2', 'n1']);
    expect(p1.nextCursor).toBeDefined();

    const p2 = (
      await app.inject({
        method: 'GET',
        url: `/v1/history?limit=2&cursor=${encodeURIComponent(p1.nextCursor ?? '')}`,
      })
    ).json<ListBody>();
    expect(p2.items.map((i) => i.text)).toEqual(['n0']);
    expect(p2.nextCursor).toBeUndefined();
    await app.close();
  });

  it('returns 401 when the authenticator rejects', async () => {
    const repo = new InMemoryTranscriptRepo();
    const store = new TranscriptStore({
      repo,
      contentKey: DEV_CONTENT_KEY,
      tokenKey: DEV_TOKEN_INDEX_KEY,
    });
    const rejecting: Authenticator = {
      authenticate: (_req: FastifyRequest) => Promise.reject(new UndertoneError('AUTH_INVALID')),
    };
    const app = Fastify({ logger: false });
    registerHistoryRoutes(app, { store, authenticator: rejecting });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/v1/history' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('AUTH_INVALID');
    await app.close();
  });
});

describe('DELETE /v1/history/:id', () => {
  it("deletes the caller's own transcript → { ok: true }", async () => {
    const { app, store, repo } = build();
    const item = await store.persist({
      userId: MOCK_USER,
      text: 'bye',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await app.ready();

    const res = await app.inject({ method: 'DELETE', url: `/v1/history/${item.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>().ok).toBe(true);
    expect(repo.rawTranscripts()).toHaveLength(0);
    await app.close();
  });

  it("returns 404 when the transcript is not the caller's", async () => {
    const { app, store } = build();
    // Owned by someone else — the mock auth caller (user_mock) must not be able to delete it.
    const item = await store.persist({
      userId: 'someone_else',
      text: 'not yours',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await app.ready();

    const res = await app.inject({ method: 'DELETE', url: `/v1/history/${item.id}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = build();
    await app.ready();
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/history/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /v1/history', () => {
  it("bulk-deletes the caller's history and returns the count", async () => {
    const { app, store } = build();
    await store.persist({
      userId: MOCK_USER,
      text: 'a',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await store.persist({
      userId: MOCK_USER,
      text: 'b',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await store.persist({
      userId: 'other',
      text: 'c',
      appName: 'Slack',
      register: 'chat',
      wordCount: 1,
    });
    await app.ready();

    const res = await app.inject({ method: 'DELETE', url: '/v1/history' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean; deleted: number }>()).toEqual({ ok: true, deleted: 2 });
    // The other user's row survives.
    expect((await store.list({ userId: 'other' })).items).toHaveLength(1);
    await app.close();
  });
});
