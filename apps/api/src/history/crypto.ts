// Transcript content encryption — AES-256-GCM (CONTRACTS.md §7, DECISIONS D-005).
//
// Privacy non-negotiable (guide §3): no plaintext transcript ever hits disk server-side. The
// service layer encrypts here BEFORE handing bytes to any `TranscriptRepo`; the repo only ever
// sees ciphertext + iv.
//
// Storage layout (documented, verified on decrypt):
//   - `iv`         column: 12 random bytes, fresh per row (GCM nonce).
//   - `ciphertext` column: the GCM ciphertext with its 16-byte auth tag APPENDED
//                          (`ciphertext = enc || tag`). Decryption splits the trailing 16 bytes
//                          back off as the tag and verifies it via `decipher.final()`, which
//                          throws on any tamper — decryption NEVER silently returns plaintext.
//   - `key_version` column: selects the content key; starts at 1 (rotation-ready).
//
// Key source: `TRANSCRIPT_KEY` env (base64-encoded 32 bytes, §10). Under MOCK_MODE the env var
// may be empty, so we fall back to a documented, deterministic dev-default key (the
// SESSION_JWT_SECRET pattern) — round-trips work keyless in tests; real mode requires the real
// key. The dev-default is derived from a content-specific label so it is DISTINCT from the token
// index key (§7: "separate key from content").
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Current content-key version stamped on every new row (§7 `key_version`). */
export const KEY_VERSION = 1;

/** AES-256 key length in bytes. */
export const CONTENT_KEY_BYTES = 32;

/** GCM nonce length in bytes. */
export const IV_BYTES = 12;

/** GCM authentication tag length in bytes. */
export const AUTH_TAG_BYTES = 16;

/**
 * Deterministic dev-default content key for MOCK_MODE / keyless tests. Derived from a
 * content-specific label so it never collides with the token-index dev key. NEVER used in real
 * mode — {@link resolveContentKey} demands the real `TRANSCRIPT_KEY` when not mocked.
 */
export const DEV_CONTENT_KEY: Buffer = createHash('sha256')
  .update('undertone::dev::transcript-content-key::v1')
  .digest();

/** The at-rest encrypted form of a transcript — exactly the §7 `transcripts` content columns. */
export interface EncryptedPayload {
  /** GCM ciphertext with the 16-byte auth tag appended. */
  ciphertext: Buffer;
  /** 12-byte random GCM nonce. */
  iv: Buffer;
  /** Content-key version used (currently always {@link KEY_VERSION}). */
  keyVersion: number;
}

/** Thrown when a stored row references a content-key version this build cannot decrypt. */
export class UnsupportedKeyVersionError extends Error {
  readonly keyVersion: number;
  constructor(keyVersion: number) {
    super(`unsupported transcript key_version ${keyVersion}`);
    this.name = 'UnsupportedKeyVersionError';
    this.keyVersion = keyVersion;
  }
}

/** Decode a base64 32-byte key, rejecting anything that is not exactly 32 bytes. */
function decodeKey(b64: string, name: string): Buffer {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== CONTENT_KEY_BYTES) {
    throw new Error(
      `${name} must be base64-encoded ${CONTENT_KEY_BYTES} bytes (decoded ${buf.length})`,
    );
  }
  return buf;
}

/**
 * Resolve the AES-256-GCM content key from env. Real mode requires a base64 32-byte
 * `TRANSCRIPT_KEY`; mock mode with an empty value falls back to {@link DEV_CONTENT_KEY}.
 */
export function resolveContentKey(env: { transcriptKey: string; mock: boolean }): Buffer {
  if (env.transcriptKey !== '') return decodeKey(env.transcriptKey, 'TRANSCRIPT_KEY');
  if (env.mock) return DEV_CONTENT_KEY;
  throw new Error('TRANSCRIPT_KEY is required outside MOCK_MODE (base64 32 bytes)');
}

/**
 * Encrypt UTF-8 plaintext under `key` with a fresh random IV. Returns the exact at-rest columns;
 * the auth tag is appended to `ciphertext` per the layout documented above.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]), iv, keyVersion: KEY_VERSION };
}

/**
 * Decrypt a stored payload under `key`. Verifies the GCM auth tag — throws if the ciphertext, IV,
 * tag, or key is wrong (tamper detection). A successful return is authenticated plaintext; there
 * is no code path that returns unverified bytes.
 */
export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const { ciphertext, iv } = payload;
  if (ciphertext.length < AUTH_TAG_BYTES) {
    throw new Error('ciphertext too short to contain a GCM auth tag');
  }
  const tag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES);
  const data = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // `final()` throws on auth-tag mismatch — this is the tamper guard.
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
