import { describe, it, expect } from 'vitest';
import { FakeHistoryApi, HistoryApiError, matchesQuery, wordsOf } from '../history';
import { makeItem, makeSeries } from './test-fixtures';

describe('wordsOf / matchesQuery — exact-word (AND) semantics', () => {
  it('tokenizes on case + punctuation boundaries', () => {
    expect(wordsOf('Kubernetes cluster, up!')).toEqual(['kubernetes', 'cluster', 'up']);
  });

  it('matches whole words only, ANDing multiple query words', () => {
    const text = 'deploy the kubernetes cluster tonight';
    expect(matchesQuery(text, 'kubernetes')).toBe(true);
    expect(matchesQuery(text, 'kubernetes cluster')).toBe(true);
    // substring is NOT a match (whole-word)
    expect(matchesQuery(text, 'kube')).toBe(false);
    // one missing word fails the AND
    expect(matchesQuery(text, 'kubernetes yesterday')).toBe(false);
    // empty query matches everything
    expect(matchesQuery(text, '   ')).toBe(true);
  });
});

describe('FakeHistoryApi.list — ordering + cursor pagination', () => {
  it('returns items newest-first with no cursor when they fit in one page', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const page = await api.list();
    expect(page.items.map((i) => i.id)).toEqual(['i0', 'i1', 'i2']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('paginates via nextCursor and stops on the last page', async () => {
    const api = new FakeHistoryApi(makeSeries(5));
    const p1 = await api.list({ limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(['i0', 'i1']);
    expect(p1.nextCursor).toBeDefined();

    const p2 = await api.list({ limit: 2, cursor: p1.nextCursor });
    expect(p2.items.map((i) => i.id)).toEqual(['i2', 'i3']);
    expect(p2.nextCursor).toBeDefined();

    const p3 = await api.list({ limit: 2, cursor: p2.nextCursor });
    expect(p3.items.map((i) => i.id)).toEqual(['i4']);
    expect(p3.nextCursor).toBeUndefined();
  });

  it('a malformed cursor is treated as "no cursor" (returns the first page)', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const page = await api.list({ cursor: 'not-base64-!!!' });
    expect(page.items.map((i) => i.id)).toEqual(['i0', 'i1', 'i2']);
  });
});

describe('FakeHistoryApi.list — search', () => {
  it('filters to items containing all query words, newest-first', async () => {
    const api = new FakeHistoryApi([
      makeItem({ id: 'a', text: 'deploy kubernetes now', createdAt: '2026-07-15T12:00:00.000Z' }),
      makeItem({ id: 'b', text: 'buy milk', createdAt: '2026-07-15T11:00:00.000Z' }),
      makeItem({ id: 'c', text: 'kubernetes upgrade plan', createdAt: '2026-07-15T10:00:00.000Z' }),
    ]);
    const page = await api.list({ q: 'kubernetes' });
    expect(page.items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('returns an empty page when nothing matches', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const page = await api.list({ q: 'zzzznomatch' });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('paginates within a filtered result set', async () => {
    const api = new FakeHistoryApi(
      makeSeries(6, (i) => (i % 2 === 0 ? `alpha word ${i}` : `beta ${i}`)),
    );
    const p1 = await api.list({ q: 'alpha', limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(['i0', 'i2']);
    expect(p1.nextCursor).toBeDefined();
    const p2 = await api.list({ q: 'alpha', limit: 2, cursor: p1.nextCursor });
    expect(p2.items.map((i) => i.id)).toEqual(['i4']);
    expect(p2.nextCursor).toBeUndefined();
  });
});

describe('FakeHistoryApi mutations', () => {
  it('remove drops the item and returns ok', async () => {
    const api = new FakeHistoryApi(makeSeries(3));
    const res = await api.remove('i1');
    expect(res).toEqual({ ok: true });
    expect(api.size).toBe(2);
    const page = await api.list();
    expect(page.items.map((i) => i.id)).toEqual(['i0', 'i2']);
  });

  it('remove of an unknown id throws a notFound HistoryApiError', async () => {
    const api = new FakeHistoryApi(makeSeries(2));
    await expect(api.remove('nope')).rejects.toBeInstanceOf(HistoryApiError);
    await expect(api.remove('nope')).rejects.toMatchObject({ kind: 'notFound', status: 404 });
    expect(api.size).toBe(2);
  });

  it('removeAll empties the store and reports the count', async () => {
    const api = new FakeHistoryApi(makeSeries(4));
    const res = await api.removeAll();
    expect(res).toEqual({ ok: true, deleted: 4 });
    expect(api.size).toBe(0);
    const again = await api.removeAll();
    expect(again).toEqual({ ok: true, deleted: 0 });
  });
});

describe('FakeHistoryApi failure injection', () => {
  it('list rejects with the armed error', async () => {
    const err = new HistoryApiError('server', 'boom', { status: 500 });
    const api = new FakeHistoryApi(makeSeries(2), { failList: err });
    await expect(api.list()).rejects.toBe(err);
    api.setFailList(undefined);
    const page = await api.list();
    expect(page.items).toHaveLength(2);
  });
});
