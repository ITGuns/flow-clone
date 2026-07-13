import { describe, it, expect } from 'vitest';
import type { DictionaryEntry } from './types';
import {
  DICT_MAX_ENTRIES,
  estimateDictionaryTokens,
  filterDictionary,
  trigramSimilarity,
} from './dict-filter';

function entry(phrase: string, soundsLike: string[] = []): DictionaryEntry {
  return { id: `id-${phrase}`, phrase, soundsLike, createdAt: '2026-07-14T00:00:00.000Z' };
}

/** Build N small entries so the token estimate stays well under the ~2k cap. */
function manySmall(count: number): DictionaryEntry[] {
  return Array.from({ length: count }, (_v, i) => entry(`w${i}`));
}

describe('trigramSimilarity', () => {
  it('is 1.0 when every query trigram occurs in the text', () => {
    expect(trigramSimilarity('Kubernetes', 'deploy to kubernetes now')).toBe(1);
  });

  it('is ~0 for an unrelated transcript', () => {
    expect(trigramSimilarity('Kubernetes', 'the weather is lovely today')).toBeLessThan(0.4);
  });

  it('is 0 for a query shorter than a trigram', () => {
    expect(trigramSimilarity('ok', 'ok that works')).toBe(0);
  });
});

describe('filterDictionary — under cap passthrough', () => {
  it('returns entries unchanged when within both caps', () => {
    const entries = [entry('Kubernetes', ['cooper netties']), entry('Postgres')];
    const out = filterDictionary(entries, 'unrelated transcript with no matches at all');
    expect(out).toEqual(entries);
  });

  it('returns a fresh array, not the input reference', () => {
    const entries = [entry('Kubernetes')];
    const out = filterDictionary(entries, 'anything');
    expect(out).not.toBe(entries);
    expect(out).toEqual(entries);
  });

  it('passes through at exactly 200 entries (boundary is inclusive)', () => {
    const entries = manySmall(DICT_MAX_ENTRIES); // 200
    expect(entries.length).toBe(200);
    // None of these tokens occur in the transcript; passthrough must ignore matching entirely.
    const out = filterDictionary(entries, 'completely different words here');
    expect(out).toEqual(entries);
  });
});

describe('filterDictionary — over cap fuzzy filter', () => {
  it('filters once past 200 entries, keeping matches and dropping non-matches', () => {
    const overflow = manySmall(DICT_MAX_ENTRIES); // 200 non-matching filler
    const matching = entry('Kubernetes', ['cooper netties']);
    const alsoMatching = entry('Postgres');
    const nonMatching = entry('Xylophone');
    const entries = [...overflow, matching, alsoMatching, nonMatching]; // 203 entries → over cap

    const out = filterDictionary(entries, 'we deploy kubernetes on postgres today');

    expect(out).toContainEqual(matching);
    expect(out).toContainEqual(alsoMatching);
    expect(out).not.toContainEqual(nonMatching);
    // The 200 filler entries (w0…w199) do not occur in the transcript and are dropped.
    expect(out.every((e) => !e.phrase.startsWith('w'))).toBe(true);
  });

  it('matches via a soundsLike variant, not just the phrase', () => {
    const entries = [...manySmall(DICT_MAX_ENTRIES + 1), entry('Kubernetes', ['cooper netties'])];
    const out = filterDictionary(entries, 'run it on cooper netties please');
    expect(out).toContainEqual(entry('Kubernetes', ['cooper netties']));
  });

  it('filters when the token estimate exceeds ~2k even with few entries', () => {
    // One entry whose text alone is ~8k chars → ~2k tokens, tripping the token cap at count 1.
    const huge = entry('X'.repeat(8000));
    const relevant = entry('Kubernetes');
    const out = filterDictionary([huge, relevant], 'kubernetes rollout');
    expect(estimateDictionaryTokens([huge, relevant])).toBeGreaterThan(2000);
    expect(out).toContainEqual(relevant);
    expect(out).not.toContainEqual(huge);
  });
});
