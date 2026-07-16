// AES-256-GCM content-encryption tests — the privacy non-negotiable (§3/§7). Proves round-trip,
// per-row IV randomness, ciphertext ≠ plaintext, and — critically — that any tamper fails loudly
// rather than silently returning plaintext.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  AUTH_TAG_BYTES,
  CONTENT_KEY_BYTES,
  DEV_CONTENT_KEY,
  IV_BYTES,
  KEY_VERSION,
  decrypt,
  encrypt,
  resolveContentKey,
} from './crypto';
import { DEV_TOKEN_INDEX_KEY } from './token-index';

const KEY = randomBytes(CONTENT_KEY_BYTES);
const PLAINTEXT = 'The quick brown fox jumps over the lazy dog. Ship it on Friday.';

describe('AES-256-GCM encrypt/decrypt', () => {
  it('round-trips plaintext', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    expect(decrypt(payload, KEY)).toBe(PLAINTEXT);
  });

  it('stamps key_version = 1 and uses a 12-byte IV', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    expect(payload.keyVersion).toBe(KEY_VERSION);
    expect(payload.keyVersion).toBe(1);
    expect(payload.iv).toHaveLength(IV_BYTES);
  });

  it('ciphertext is not the plaintext bytes and carries an appended 16-byte tag', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    // No plaintext at rest: the stored ciphertext must not contain the plaintext.
    expect(payload.ciphertext.toString('utf8')).not.toBe(PLAINTEXT);
    expect(payload.ciphertext.includes(Buffer.from(PLAINTEXT, 'utf8'))).toBe(false);
    // enc-body + 16-byte tag (GCM stream cipher: body length == plaintext byte length).
    expect(payload.ciphertext.length).toBe(Buffer.byteLength(PLAINTEXT, 'utf8') + AUTH_TAG_BYTES);
  });

  it('uses a fresh random IV per call (two encrypts of the same text differ)', () => {
    const a = encrypt(PLAINTEXT, KEY);
    const b = encrypt(PLAINTEXT, KEY);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    // Both still decrypt to the same plaintext.
    expect(decrypt(a, KEY)).toBe(PLAINTEXT);
    expect(decrypt(b, KEY)).toBe(PLAINTEXT);
  });

  it('empty string and unicode round-trip', () => {
    for (const text of ['', 'café — naïve — 日本語 — 🎤']) {
      expect(decrypt(encrypt(text, KEY), KEY)).toBe(text);
    }
  });
});

describe('tamper / auth-tag verification (never silently returns plaintext)', () => {
  /** Flip one bit of a byte at `offset`, using typed read/write (noUncheckedIndexedAccess-safe). */
  function flipByte(buf: Buffer, offset: number): Buffer {
    const copy = Buffer.from(buf);
    copy.writeUInt8(copy.readUInt8(offset) ^ 0x01, offset);
    return copy;
  }

  it('flipping a ciphertext byte → GCM auth failure', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    const tampered = flipByte(payload.ciphertext, 0); // flip one bit of the ciphertext body
    expect(() => decrypt({ ...payload, ciphertext: tampered }, KEY)).toThrow();
  });

  it('flipping an auth-tag byte → auth failure', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    const tampered = flipByte(payload.ciphertext, payload.ciphertext.length - 1); // appended tag
    expect(() => decrypt({ ...payload, ciphertext: tampered }, KEY)).toThrow();
  });

  it('a corrupted IV → auth failure', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    const iv = flipByte(payload.iv, 0);
    expect(() => decrypt({ ...payload, iv }, KEY)).toThrow();
  });

  it('the wrong key → auth failure (cannot read another key ring)', () => {
    const payload = encrypt(PLAINTEXT, KEY);
    expect(() => decrypt(payload, randomBytes(CONTENT_KEY_BYTES))).toThrow();
  });

  it('a truncated ciphertext (shorter than the tag) throws', () => {
    expect(() =>
      decrypt({ ciphertext: Buffer.alloc(4), iv: randomBytes(IV_BYTES), keyVersion: 1 }, KEY),
    ).toThrow(/too short/);
  });
});

describe('resolveContentKey', () => {
  it('returns the deterministic 32-byte dev key in mock mode when unset', () => {
    const key = resolveContentKey({ transcriptKey: '', mock: true });
    expect(key).toHaveLength(CONTENT_KEY_BYTES);
    expect(key.equals(DEV_CONTENT_KEY)).toBe(true);
  });

  it('dev content key is DISTINCT from the dev token-index key (separate keys, §7)', () => {
    expect(DEV_CONTENT_KEY.equals(DEV_TOKEN_INDEX_KEY)).toBe(false);
  });

  it('decodes a base64 32-byte TRANSCRIPT_KEY', () => {
    const raw = randomBytes(CONTENT_KEY_BYTES);
    const key = resolveContentKey({ transcriptKey: raw.toString('base64'), mock: false });
    expect(key.equals(raw)).toBe(true);
  });

  it('throws in real mode when TRANSCRIPT_KEY is empty', () => {
    expect(() => resolveContentKey({ transcriptKey: '', mock: false })).toThrow(/required/);
  });

  it('throws when TRANSCRIPT_KEY decodes to the wrong length', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => resolveContentKey({ transcriptKey: short, mock: false })).toThrow(/32 bytes/);
  });
});
