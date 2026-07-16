// TranscriptStore service tests — end-to-end over the in-memory repo. Proves: no plaintext at
// rest, exact-word AND search, owner isolation on read/delete, deleteAll count, empty-q lists all,
// and keyset pagination (including an equal-timestamp id tiebreak).
import { describe, it, expect } from 'vitest';
import { DEV_CONTENT_KEY } from './crypto';
import { DEV_TOKEN_INDEX_KEY } from './token-index';
import { InMemoryTranscriptRepo } from './repo';
import { TranscriptStore, decodeCursor, encodeCursor } from './store';
import type { PersistInput } from './store';

const USER = 'user_a';
const OTHER = 'user_b';

function makeStore(now?: () => Date): { store: TranscriptStore; repo: InMemoryTranscriptRepo } {
  const repo = new InMemoryTranscriptRepo(now);
  const store = new TranscriptStore({
    repo,
    contentKey: DEV_CONTENT_KEY,
    tokenKey: DEV_TOKEN_INDEX_KEY,
  });
  return { store, repo };
}

function input(overrides: Partial<PersistInput> = {}): PersistInput {
  return {
    userId: USER,
    text: 'Ship the Kubernetes cluster on Friday.',
    appName: 'Slack',
    register: 'chat',
    wordCount: 6,
    ...overrides,
  };
}

describe('persist → HistoryItem + no plaintext at rest', () => {
  it('returns a HistoryItem echoing the plaintext and metadata', async () => {
    const { store } = makeStore();
    const item = await store.persist(input());
    expect(item.text).toBe('Ship the Kubernetes cluster on Friday.');
    expect(item.appName).toBe('Slack');
    expect(item.register).toBe('chat');
    expect(item.wordCount).toBe(6);
    expect(typeof item.id).toBe('string');
    expect(new Date(item.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('stores ciphertext only — the plaintext never appears in any stored row', async () => {
    const { store, repo } = makeStore();
    const text = 'Highly confidential launch codes and secret roadmap.';
    await store.persist(input({ text, wordCount: 7 }));

    const rows = repo.rawTranscripts();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    // The stored ciphertext is not the plaintext and does not contain it.
    expect(row.ciphertext.includes(Buffer.from(text, 'utf8'))).toBe(false);
    expect(row.ciphertext.toString('utf8')).not.toContain('confidential');
    expect(row.iv).toHaveLength(12);
    expect(row.keyVersion).toBe(1);

    // The token index holds only opaque digests — no plaintext word anywhere.
    for (const t of repo.rawTokens()) {
      expect(t.tokenHmac).toHaveLength(32);
      for (const word of ['confidential', 'launch', 'codes', 'secret', 'roadmap']) {
        expect(t.tokenHmac.includes(Buffer.from(word, 'utf8'))).toBe(false);
      }
    }
  });

  it('decrypts back correctly via get (round-trip through the repo, not the persist return)', async () => {
    const { store } = makeStore();
    const item = await store.persist(input({ text: 'Decrypt me later.' }));
    const fetched = await store.get(USER, item.id);
    expect(fetched?.text).toBe('Decrypt me later.');
  });
});

describe('exact-word search (HMAC token index)', () => {
  it('matches a stored word, case/punctuation-insensitively', async () => {
    const { store } = makeStore();
    await store.persist(input({ text: 'Deploy the Kubernetes cluster.' }));
    const hit = await store.list({ userId: USER, q: 'kubernetes' });
    expect(hit.items).toHaveLength(1);
    const miss = await store.list({ userId: USER, q: 'postgres' });
    expect(miss.items).toHaveLength(0);
  });

  it('is exact-word, not substring (v2) — "kube" does not match "kubernetes"', async () => {
    const { store } = makeStore();
    await store.persist(input({ text: 'Kubernetes rollout done.' }));
    const res = await store.list({ userId: USER, q: 'kube' });
    expect(res.items).toHaveLength(0);
  });

  it('multi-word query is AND across words', async () => {
    const { store } = makeStore();
    await store.persist(input({ text: 'alpha beta gamma' }));
    await store.persist(input({ text: 'alpha delta' }));
    const both = await store.list({ userId: USER, q: 'alpha beta' });
    expect(both.items).toHaveLength(1);
    expect(both.items[0]?.text).toBe('alpha beta gamma');

    const alpha = await store.list({ userId: USER, q: 'alpha' });
    expect(alpha.items).toHaveLength(2);

    const none = await store.list({ userId: USER, q: 'alpha zeta' });
    expect(none.items).toHaveLength(0);
  });

  it('empty q lists all; punctuation-only q lists all (no filter)', async () => {
    const { store } = makeStore();
    await store.persist(input({ text: 'one' }));
    await store.persist(input({ text: 'two' }));
    expect((await store.list({ userId: USER })).items).toHaveLength(2);
    expect((await store.list({ userId: USER, q: '' })).items).toHaveLength(2);
    expect((await store.list({ userId: USER, q: '   ' })).items).toHaveLength(2);
    expect((await store.list({ userId: USER, q: '!!! ...' })).items).toHaveLength(2);
  });
});

describe('owner isolation', () => {
  it("list only returns the calling user's transcripts", async () => {
    const { store } = makeStore();
    await store.persist(input({ userId: USER, text: 'mine' }));
    await store.persist(input({ userId: OTHER, text: 'theirs' }));
    const mine = await store.list({ userId: USER });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]?.text).toBe('mine');
  });

  it("a different user cannot get another user's transcript", async () => {
    const { store } = makeStore();
    const item = await store.persist(input({ userId: USER, text: 'private' }));
    expect(await store.get(OTHER, item.id)).toBeNull();
    expect(await store.get(USER, item.id)).not.toBeNull();
  });

  it("a different user cannot delete another user's transcript", async () => {
    const { store, repo } = makeStore();
    const item = await store.persist(input({ userId: USER, text: 'keep me' }));
    expect(await store.delete(OTHER, item.id)).toBe(false);
    expect(repo.rawTranscripts()).toHaveLength(1); // still there
    expect(await store.delete(USER, item.id)).toBe(true);
    expect(repo.rawTranscripts()).toHaveLength(0);
  });
});

describe('delete + deleteAll', () => {
  it('delete removes the row and its token digests', async () => {
    const { store, repo } = makeStore();
    const item = await store.persist(input({ text: 'alpha beta gamma' }));
    expect(repo.rawTokens().length).toBeGreaterThan(0);
    expect(await store.delete(USER, item.id)).toBe(true);
    expect(repo.rawTokens()).toHaveLength(0);
  });

  it("deleteAll returns the count and only clears the caller's rows", async () => {
    const { store, repo } = makeStore();
    await store.persist(input({ userId: USER, text: 'a' }));
    await store.persist(input({ userId: USER, text: 'b' }));
    await store.persist(input({ userId: OTHER, text: 'c' }));
    expect(await store.deleteAll(USER)).toBe(2);
    expect((await store.list({ userId: USER })).items).toHaveLength(0);
    expect((await store.list({ userId: OTHER })).items).toHaveLength(1);
    expect(repo.rawTokens().every((t) => t.transcriptId !== undefined)).toBe(true);
  });

  it('deleteAll on an empty history returns 0', async () => {
    const { store } = makeStore();
    expect(await store.deleteAll(USER)).toBe(0);
  });
});

describe('pagination', () => {
  it('returns nextCursor and yields the remaining rows on the next page, newest-first', async () => {
    // Strictly increasing timestamps → deterministic newest-first ordering.
    let t = 1_700_000_000_000;
    const { store } = makeStore(() => new Date((t += 1000)));
    for (let i = 0; i < 5; i++) await store.persist(input({ text: `note ${i}` }));

    const page1 = await store.list({ userId: USER, limit: 2 });
    expect(page1.items.map((i) => i.text)).toEqual(['note 4', 'note 3']);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await store.list({ userId: USER, limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.text)).toEqual(['note 2', 'note 1']);
    expect(page2.nextCursor).toBeDefined();

    const page3 = await store.list({ userId: USER, limit: 2, cursor: page2.nextCursor });
    expect(page3.items.map((i) => i.text)).toEqual(['note 0']);
    expect(page3.nextCursor).toBeUndefined();
  });

  it('paginates without loss or duplication when timestamps collide (id tiebreak)', async () => {
    const fixed = new Date(1_700_000_000_000);
    const { store } = makeStore(() => fixed);
    for (let i = 0; i < 5; i++) await store.persist(input({ text: `dup ${i}` }));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await store.list({ userId: USER, limit: 2, cursor });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (cursor === undefined) break;
    }
    expect(new Set(seen).size).toBe(5); // all distinct, none lost, none repeated
  });

  it('clamps limit to [1, 100] and defaults to 50', async () => {
    const { store } = makeStore();
    for (let i = 0; i < 3; i++) await store.persist(input({ text: `n${i}` }));
    expect((await store.list({ userId: USER, limit: 0 })).items).toHaveLength(1);
    expect((await store.list({ userId: USER, limit: 1000 })).items).toHaveLength(3);
    expect((await store.list({ userId: USER })).items).toHaveLength(3);
  });

  it('a malformed cursor is ignored (treated as the first page)', async () => {
    const { store } = makeStore();
    await store.persist(input({ text: 'only' }));
    const res = await store.list({ userId: USER, cursor: 'not-a-valid-cursor::::' });
    expect(res.items).toHaveLength(1);
  });
});

describe('cursor codec', () => {
  it('round-trips (createdAt, id)', () => {
    const now = new Date('2026-07-14T12:34:56.789Z');
    const encoded = encodeCursor(now, 'abc-123');
    const decoded = decodeCursor(encoded);
    expect(decoded?.createdAt.toISOString()).toBe(now.toISOString());
    expect(decoded?.id).toBe('abc-123');
  });

  it('returns null on garbage', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('no-separator', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('bad-date|id', 'utf8').toString('base64url'))).toBeNull();
    expect(
      decodeCursor(Buffer.from('2026-07-14T00:00:00.000Z|', 'utf8').toString('base64url')),
    ).toBeNull();
  });
});
