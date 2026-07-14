// HMAC keyed-token search index — DECISIONS D-005, CONTRACTS.md §7.
//
// A plaintext full-text index would defeat encryption-at-rest, so search is served by a keyed
// hash. Each NORMALIZED unique word of a transcript is HMAC-SHA256'd under a key that is SEPARATE
// from the content key, and the digests are stored in `transcript_tokens`. `GET /v1/history?q=`
// HMACs the query's words the same way and matches transcripts whose token set contains them
// (exact-word, AND across multiple query words). NO plaintext word is ever stored — the index
// holds only opaque 32-byte digests. Substring/fuzzy search is explicitly v2.
import { createHash, createHmac } from 'node:crypto';

/** HMAC digest length in bytes (SHA-256). */
export const TOKEN_HMAC_BYTES = 32;

/**
 * Deterministic dev-default token-index key for MOCK_MODE / keyless tests. Derived from an
 * index-specific label so it is DISTINCT from the content dev key (§7: "separate key from
 * content"). NEVER used in real mode.
 */
export const DEV_TOKEN_INDEX_KEY: Buffer = createHash('sha256')
  .update('undertone::dev::token-index-key::v1')
  .digest();

function decodeKey(b64: string, name: string): Buffer {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${name} must be base64-encoded 32 bytes (decoded ${buf.length})`);
  }
  return buf;
}

/** Resolve the HMAC key from env (real mode requires `TOKEN_INDEX_KEY`; mock falls back). */
export function resolveTokenIndexKey(env: { tokenIndexKey: string; mock: boolean }): Buffer {
  if (env.tokenIndexKey !== '') return decodeKey(env.tokenIndexKey, 'TOKEN_INDEX_KEY');
  if (env.mock) return DEV_TOKEN_INDEX_KEY;
  throw new Error('TOKEN_INDEX_KEY is required outside MOCK_MODE (base64 32 bytes)');
}

/**
 * Normalize free text into the set of unique searchable words: lowercase, split on any run of
 * non-alphanumeric characters (Unicode-aware), drop empties, dedupe (insertion order preserved).
 * The same normalization is applied to stored transcripts and to query strings, so search is a
 * pure set-membership test on identical tokens.
 */
export function normalizeWords(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw !== '' && !seen.has(raw)) seen.add(raw);
  }
  return [...seen];
}

/** HMAC-SHA256 a single already-normalized word under `key`. */
export function hmacWord(word: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(word, 'utf8').digest();
}

/**
 * Produce the deduplicated HMAC digests for every unique normalized word in `text`. This is both
 * the row set written to `transcript_tokens` on persist and (over the query string) the set a
 * search matches against.
 */
export function tokenHmacs(text: string, key: Buffer): Buffer[] {
  return normalizeWords(text).map((word) => hmacWord(word, key));
}
