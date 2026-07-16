// HMAC token-index tests — D-005. Proves normalization, keyed determinism, key separation, and
// that the index stores only opaque digests (no plaintext word).
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  DEV_TOKEN_INDEX_KEY,
  TOKEN_HMAC_BYTES,
  hmacWord,
  normalizeWords,
  resolveTokenIndexKey,
  tokenHmacs,
} from './token-index';

const KEY = randomBytes(32);

describe('normalizeWords', () => {
  it('lowercases, strips punctuation, splits on whitespace, and dedupes', () => {
    expect(normalizeWords('Hello, HELLO world! World?')).toEqual(['hello', 'world']);
  });

  it('handles unicode letters/numbers and collapses separators', () => {
    expect(normalizeWords('café  123... naïve')).toEqual(['café', '123', 'naïve']);
  });

  it('returns [] for empty / punctuation-only input', () => {
    expect(normalizeWords('')).toEqual([]);
    expect(normalizeWords('  !!! ... --- ')).toEqual([]);
  });

  it('preserves first-seen order of unique words', () => {
    expect(normalizeWords('b a b c a')).toEqual(['b', 'a', 'c']);
  });
});

describe('hmacWord / tokenHmacs', () => {
  it('produces a 32-byte digest, deterministic for the same word+key', () => {
    const a = hmacWord('kubernetes', KEY);
    const b = hmacWord('kubernetes', KEY);
    expect(a).toHaveLength(TOKEN_HMAC_BYTES);
    expect(a.equals(b)).toBe(true);
  });

  it('a different key yields a different digest for the same word', () => {
    const a = hmacWord('kubernetes', KEY);
    const b = hmacWord('kubernetes', randomBytes(32));
    expect(a.equals(b)).toBe(false);
  });

  it('different words yield different digests', () => {
    expect(hmacWord('alpha', KEY).equals(hmacWord('beta', KEY))).toBe(false);
  });

  it('stores no plaintext word — digest bytes never contain the source word', () => {
    const word = 'kubernetes';
    const digest = hmacWord(word, KEY);
    expect(digest.includes(Buffer.from(word, 'utf8'))).toBe(false);
    expect(digest.toString('utf8')).not.toContain(word);
  });

  it('tokenHmacs dedupes and matches per-word hmacs of the normalized set', () => {
    const digests = tokenHmacs('Ship Ship it', KEY);
    expect(digests).toHaveLength(2); // ship, it
    expect(digests[0]?.equals(hmacWord('ship', KEY))).toBe(true);
    expect(digests[1]?.equals(hmacWord('it', KEY))).toBe(true);
  });

  it('query normalization matches stored-word normalization (case/punctuation insensitive)', () => {
    const stored = tokenHmacs('Deploy the Kubernetes cluster.', KEY);
    const query = tokenHmacs('kubernetes', KEY)[0];
    expect(query).toBeDefined();
    expect(stored.some((d) => query && d.equals(query))).toBe(true);
  });
});

describe('resolveTokenIndexKey', () => {
  it('returns the deterministic 32-byte dev key in mock mode when unset', () => {
    const key = resolveTokenIndexKey({ tokenIndexKey: '', mock: true });
    expect(key.equals(DEV_TOKEN_INDEX_KEY)).toBe(true);
  });

  it('decodes a base64 32-byte TOKEN_INDEX_KEY', () => {
    const raw = randomBytes(32);
    expect(
      resolveTokenIndexKey({ tokenIndexKey: raw.toString('base64'), mock: false }).equals(raw),
    ).toBe(true);
  });

  it('throws in real mode when TOKEN_INDEX_KEY is empty', () => {
    expect(() => resolveTokenIndexKey({ tokenIndexKey: '', mock: false })).toThrow(/required/);
  });
});
