// TranscriptStore — the service layer that owns encryption + the HMAC search index and speaks
// HistoryItem to callers, delegating opaque-byte storage to a TranscriptRepo.
//
// This is where the privacy non-negotiable is enforced: persist() encrypts before the repo ever
// sees the text and writes only HMAC digests to the index; list()/get() decrypt for the owner.
// Never persists audio — there is no audio path here.
import type { HistoryItem, Register } from '@undertone/shared';
import type { RegisterValue } from '../db/schema';
import {
  KEY_VERSION,
  UnsupportedKeyVersionError,
  decrypt,
  encrypt,
  resolveContentKey,
} from './crypto';
import type { StoredTranscript, TranscriptRepo } from './repo';
import { resolveTokenIndexKey, tokenHmacs } from './token-index';

/** Default page size for `GET /v1/history` (§5). */
export const DEFAULT_LIMIT = 50;
/** Hard cap on page size (§5). */
export const MAX_LIMIT = 100;

/** Dependencies for the store: the DB port plus the two independent keys. */
export interface TranscriptStoreDeps {
  repo: TranscriptRepo;
  /** AES-256-GCM content key (32 bytes). */
  contentKey: Buffer;
  /** HMAC-SHA256 token-index key (32 bytes) — SEPARATE from the content key. */
  tokenKey: Buffer;
}

/** Input to {@link TranscriptStore.persist} — the fields the pipeline has at `format.done`. */
export interface PersistInput {
  userId: string;
  text: string;
  appName: string;
  register: Register;
  wordCount: number;
}

/** Options for {@link TranscriptStore.list}. `q` is exact-word (AND) search; `cursor` is opaque. */
export interface ListOptions {
  userId: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** A page of history plus the opaque cursor for the next page (absent on the last page). */
export interface HistoryPage {
  items: HistoryItem[];
  nextCursor?: string;
}

/** Clamp a requested limit into [1, MAX_LIMIT], defaulting when absent/NaN. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return 1;
  if (floored > MAX_LIMIT) return MAX_LIMIT;
  return floored;
}

/** Encode `(createdAt, id)` into an opaque base64url cursor (§5). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/** Decode an opaque cursor; returns null for anything malformed (treated as "no cursor"). */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf('|');
  if (sep === -1) return null;
  const iso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const createdAt = new Date(iso);
  if (id === '' || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

export class TranscriptStore {
  private readonly repo: TranscriptRepo;
  private readonly contentKey: Buffer;
  private readonly tokenKey: Buffer;

  constructor(deps: TranscriptStoreDeps) {
    this.repo = deps.repo;
    this.contentKey = deps.contentKey;
    this.tokenKey = deps.tokenKey;
  }

  /** Encrypt + index + store one transcript. Returns the HistoryItem (plaintext, for the owner). */
  async persist(input: PersistInput): Promise<HistoryItem> {
    const payload = encrypt(input.text, this.contentKey);
    const stored = await this.repo.insert({
      userId: input.userId,
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      keyVersion: payload.keyVersion,
      appName: input.appName,
      register: input.register as RegisterValue,
      wordCount: input.wordCount,
      tokenHmacs: tokenHmacs(input.text, this.tokenKey),
    });
    return this.toItem(stored, input.text);
  }

  /** List the owner's history, newest-first, optionally exact-word filtered, keyset-paginated. */
  async list(options: ListOptions): Promise<HistoryPage> {
    const limit = clampLimit(options.limit);
    const cursor =
      options.cursor !== undefined && options.cursor !== ''
        ? (decodeCursor(options.cursor) ?? undefined)
        : undefined;

    // Empty or punctuation-only queries carry no tokens → no filter (list everything).
    const queryTokens =
      options.q !== undefined && options.q.trim() !== ''
        ? tokenHmacs(options.q, this.tokenKey)
        : [];
    const tokenFilter = queryTokens.length > 0 ? queryTokens : undefined;

    // Over-fetch by one to detect whether a further page exists.
    const rows = await this.repo.list({
      userId: options.userId,
      tokenHmacs: tokenFilter,
      cursor: cursor ? { createdAt: cursor.createdAt, id: cursor.id } : undefined,
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row) => this.toItem(row));

    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : undefined;
    return { items, nextCursor };
  }

  /** Fetch and decrypt one transcript for its owner (null if missing/not owned). */
  async get(userId: string, id: string): Promise<HistoryItem | null> {
    const row = await this.repo.get(userId, id);
    return row ? this.toItem(row) : null;
  }

  /** Delete one transcript for its owner. Returns false if it does not exist / is not owned. */
  delete(userId: string, id: string): Promise<boolean> {
    return this.repo.delete(userId, id);
  }

  /** Delete every transcript for an owner. Returns the number removed. */
  deleteAll(userId: string): Promise<number> {
    return this.repo.deleteAll(userId);
  }

  /** Build a HistoryItem, decrypting when the plaintext is not already known (persist path). */
  private toItem(row: StoredTranscript, knownText?: string): HistoryItem {
    if (row.keyVersion !== KEY_VERSION) throw new UnsupportedKeyVersionError(row.keyVersion);
    const text =
      knownText ??
      decrypt(
        { ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.keyVersion },
        this.contentKey,
      );
    return {
      id: row.id,
      text,
      appName: row.appName,
      register: row.register,
      wordCount: row.wordCount,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Build a TranscriptStore from the typed Env, resolving both keys (dev defaults under mock). */
export function createTranscriptStore(
  env: { transcriptKey: string; tokenIndexKey: string; mock: boolean },
  repo: TranscriptRepo,
): TranscriptStore {
  return new TranscriptStore({
    repo,
    contentKey: resolveContentKey(env),
    tokenKey: resolveTokenIndexKey(env),
  });
}
