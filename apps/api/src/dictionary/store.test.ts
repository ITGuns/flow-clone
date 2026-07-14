// Tests for the dictionary service (DictionaryStore) + loadDictionaryForUser — CONTRACTS §5/§6/§7.
// Written against the InMemoryDictionaryRepo fake; no live DB, keyless, MOCK_MODE-agnostic.
import { describe, it, expect } from 'vitest';
import type { DictionaryEntry } from '@undertone/shared';
import { InMemoryDictionaryRepo } from './repo';
import {
  DictionaryStore,
  DictionaryError,
  MAX_DICTIONARY_ENTRIES,
  loadDictionaryForUser,
} from './store';

const USER = 'user_a';
const OTHER = 'user_b';

function makeStore(): DictionaryStore {
  // Deterministic clock; ids come from the repo/randomUUID default (captured from results).
  return new DictionaryStore(new InMemoryDictionaryRepo(), {
    now: () => new Date('2026-07-14T12:00:00.000Z'),
  });
}

/** Assert that a promise rejects with a DictionaryError carrying the given HTTP status. */
async function expectStatus(p: Promise<unknown>, status: number): Promise<DictionaryError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DictionaryError);
    expect((err as DictionaryError).httpStatus).toBe(status);
    return err as DictionaryError;
  }
  throw new Error(`expected rejection with status ${status}, but it resolved`);
}

describe('DictionaryStore.create', () => {
  it('creates an entry with the §1 shape and defaults soundsLike to []', async () => {
    const store = makeStore();
    const entry = await store.create(USER, { phrase: 'Kubernetes' });
    expect(entry.phrase).toBe('Kubernetes');
    expect(entry.soundsLike).toEqual([]);
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.createdAt).toBe('2026-07-14T12:00:00.000Z');
    // No stray fields beyond the §1 DictionaryEntry contract.
    expect(Object.keys(entry).sort()).toEqual(['createdAt', 'id', 'phrase', 'soundsLike']);
  });

  it('keeps provided soundsLike variants', async () => {
    const store = makeStore();
    const entry = await store.create(USER, {
      phrase: 'Kubernetes',
      soundsLike: ['cooper netties', 'koober netis'],
    });
    expect(entry.soundsLike).toEqual(['cooper netties', 'koober netis']);
  });

  it('rejects a duplicate phrase case-insensitively → 409', async () => {
    const store = makeStore();
    await store.create(USER, { phrase: 'Kubernetes' });
    const err = await expectStatus(store.create(USER, { phrase: 'KUBERNETES' }), 409);
    expect(err.errorCode).toBe('DUPLICATE_PHRASE');
  });

  it('allows the same phrase for a different user (uniqueness is per-user)', async () => {
    const store = makeStore();
    await store.create(USER, { phrase: 'Kubernetes' });
    const entry = await store.create(OTHER, { phrase: 'Kubernetes' });
    expect(entry.phrase).toBe('Kubernetes');
  });

  it('rejects creation beyond the 500-entry cap → 422', async () => {
    const store = makeStore();
    for (let i = 0; i < MAX_DICTIONARY_ENTRIES; i++) {
      await store.create(USER, { phrase: `phrase ${i}` });
    }
    const err = await expectStatus(store.create(USER, { phrase: 'one too many' }), 422);
    expect(err.errorCode).toBe('CAP_EXCEEDED');
    // The cap is per-user: a different user is unaffected.
    await expect(store.create(OTHER, { phrase: 'fine' })).resolves.toMatchObject({
      phrase: 'fine',
    });
  });

  it('rejects a non-object body → 400', async () => {
    const store = makeStore();
    await expectStatus(store.create(USER, null), 400);
    await expectStatus(store.create(USER, 'nope'), 400);
    await expectStatus(store.create(USER, undefined), 400);
  });

  it('rejects a missing / empty / non-string phrase → 400', async () => {
    const store = makeStore();
    await expectStatus(store.create(USER, {}), 400);
    await expectStatus(store.create(USER, { phrase: '' }), 400);
    await expectStatus(store.create(USER, { phrase: '   ' }), 400);
    await expectStatus(store.create(USER, { phrase: 123 }), 400);
  });

  it('rejects a soundsLike that is not an array of strings → 400', async () => {
    const store = makeStore();
    await expectStatus(store.create(USER, { phrase: 'x', soundsLike: 'not-array' }), 400);
    await expectStatus(store.create(USER, { phrase: 'x', soundsLike: [1, 2] }), 400);
    await expectStatus(store.create(USER, { phrase: 'x', soundsLike: ['ok', 5] }), 400);
  });

  it('trims the phrase and drops blank soundsLike entries', async () => {
    const store = makeStore();
    const entry = await store.create(USER, {
      phrase: '  Docker  ',
      soundsLike: ['  darker  ', '', '   '],
    });
    expect(entry.phrase).toBe('Docker');
    expect(entry.soundsLike).toEqual(['darker']);
  });
});

describe('DictionaryStore.list', () => {
  it('lists only the calling user’s entries', async () => {
    const store = makeStore();
    await store.create(USER, { phrase: 'alpha' });
    await store.create(USER, { phrase: 'beta' });
    await store.create(OTHER, { phrase: 'gamma' });
    const entries = await store.list(USER);
    expect(entries.map((e) => e.phrase).sort()).toEqual(['alpha', 'beta']);
  });

  it('returns [] for a user with no entries', async () => {
    const store = makeStore();
    await expect(store.list(USER)).resolves.toEqual([]);
  });
});

describe('DictionaryStore.update', () => {
  it('updates phrase and soundsLike', async () => {
    const store = makeStore();
    const created = await store.create(USER, { phrase: 'kube', soundsLike: ['cube'] });
    const updated = await store.update(USER, created.id, {
      phrase: 'Kubernetes',
      soundsLike: ['cooper netties'],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.phrase).toBe('Kubernetes');
    expect(updated.soundsLike).toEqual(['cooper netties']);
  });

  it('supports a partial patch (phrase only)', async () => {
    const store = makeStore();
    const created = await store.create(USER, { phrase: 'kube', soundsLike: ['cube'] });
    const updated = await store.update(USER, created.id, { phrase: 'Kubernetes' });
    expect(updated.phrase).toBe('Kubernetes');
    expect(updated.soundsLike).toEqual(['cube']); // untouched
  });

  it('allows re-casing the entry’s own phrase (no self-conflict)', async () => {
    const store = makeStore();
    const created = await store.create(USER, { phrase: 'kubernetes' });
    const updated = await store.update(USER, created.id, { phrase: 'Kubernetes' });
    expect(updated.phrase).toBe('Kubernetes');
  });

  it('rejects a patch that collides with another entry → 409', async () => {
    const store = makeStore();
    await store.create(USER, { phrase: 'docker' });
    const second = await store.create(USER, { phrase: 'kubernetes' });
    const err = await expectStatus(store.update(USER, second.id, { phrase: 'DOCKER' }), 409);
    expect(err.errorCode).toBe('DUPLICATE_PHRASE');
  });

  it('returns 404 for a missing id', async () => {
    const store = makeStore();
    await expectStatus(store.update(USER, 'no-such-id', { phrase: 'x' }), 404);
  });

  it('returns 404 when the entry belongs to another user (non-owner)', async () => {
    const store = makeStore();
    const created = await store.create(OTHER, { phrase: 'secret' });
    await expectStatus(store.update(USER, created.id, { phrase: 'stolen' }), 404);
  });

  it('rejects an empty / invalid patch → 400', async () => {
    const store = makeStore();
    const created = await store.create(USER, { phrase: 'kube' });
    await expectStatus(store.update(USER, created.id, {}), 400);
    await expectStatus(store.update(USER, created.id, { phrase: '' }), 400);
    await expectStatus(store.update(USER, created.id, { phrase: 42 }), 400);
    await expectStatus(store.update(USER, created.id, { soundsLike: 'nope' }), 400);
    await expectStatus(store.update(USER, created.id, null), 400);
  });
});

describe('DictionaryStore.delete', () => {
  it('deletes an owned entry', async () => {
    const store = makeStore();
    const created = await store.create(USER, { phrase: 'kube' });
    await expect(store.delete(USER, created.id)).resolves.toBeUndefined();
    await expect(store.list(USER)).resolves.toEqual([]);
  });

  it('returns 404 for a missing id', async () => {
    const store = makeStore();
    await expectStatus(store.delete(USER, 'no-such-id'), 404);
  });

  it('returns 404 when the entry belongs to another user (non-owner)', async () => {
    const store = makeStore();
    const created = await store.create(OTHER, { phrase: 'secret' });
    await expectStatus(store.delete(USER, created.id), 404);
    // still there for its owner
    await expect(store.list(OTHER)).resolves.toHaveLength(1);
  });
});

describe('loadDictionaryForUser', () => {
  it('returns the user’s FULL entry list, unfiltered (filtering is the pipeline’s job §6)', async () => {
    const store = makeStore();
    await store.create(USER, { phrase: 'alpha' });
    await store.create(USER, { phrase: 'beta' });
    await store.create(OTHER, { phrase: 'gamma' });
    const loaded: DictionaryEntry[] = await loadDictionaryForUser({ store }, USER);
    expect(loaded.map((e) => e.phrase).sort()).toEqual(['alpha', 'beta']);
    // Identical to store.list — the loader adds no filtering of its own.
    expect(loaded).toEqual(await store.list(USER));
  });
});
