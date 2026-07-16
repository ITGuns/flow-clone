// TranscriptRepo port + two implementations — the DB boundary for encrypted history.
//
// The repo sees ONLY ciphertext / iv / HMAC bytes: encryption and HMAC happen one layer up in
// TranscriptStore, so the repo has no idea what a transcript says. This keeps the crypto seam
// clean and lets the service be tested with an in-memory fake (no live Postgres).
//
//   - DrizzleTranscriptRepo — the real §7 queries over apps/api/src/db.
//   - InMemoryTranscriptRepo — deterministic fake for the service/route tests; exposes raw stored
//     rows so tests can prove no plaintext is at rest.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { RegisterValue } from '../db/schema';
import { schema, transcriptTokens, transcripts } from '../db/schema';

/** A stored transcript row as the repo sees it — encrypted content, no plaintext. */
export interface StoredTranscript {
  id: string;
  userId: string;
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: number;
  appName: string;
  register: RegisterValue;
  wordCount: number;
  createdAt: Date;
}

/** The write shape for a new transcript plus its HMAC token digests (written atomically). */
export interface InsertTranscript {
  userId: string;
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: number;
  appName: string;
  register: RegisterValue;
  wordCount: number;
  /** Unique, normalized-word HMAC digests for the search index. */
  tokenHmacs: Buffer[];
}

/** Keyset cursor: rows strictly older than `(createdAt, id)` under (createdAt desc, id desc). */
export interface RepoCursor {
  createdAt: Date;
  id: string;
}

/** A page query. `tokenHmacs` (when present & non-empty) applies AND-semantics exact-word search. */
export interface ListQuery {
  userId: string;
  tokenHmacs?: Buffer[];
  cursor?: RepoCursor;
  limit: number;
}

/** DB boundary for history. Callers pass/receive only encrypted bytes. */
export interface TranscriptRepo {
  /** Insert a transcript and its token rows atomically; returns the stored row. */
  insert(input: InsertTranscript): Promise<StoredTranscript>;
  /** List an owner's transcripts newest-first, keyset-paginated, optionally token-filtered. */
  list(query: ListQuery): Promise<StoredTranscript[]>;
  /** Fetch one transcript by id, scoped to its owner (null if missing or not owned). */
  get(userId: string, id: string): Promise<StoredTranscript | null>;
  /** Delete one transcript by id, scoped to owner. Returns false if nothing matched. */
  delete(userId: string, id: string): Promise<boolean>;
  /** Delete every transcript for an owner. Returns the number deleted. */
  deleteAll(userId: string): Promise<number>;
}

// ── Drizzle implementation ───────────────────────────────────────────────────────────────────

function toStored(row: typeof transcripts.$inferSelect): StoredTranscript {
  return {
    id: row.id,
    userId: row.userId,
    ciphertext: row.ciphertext,
    iv: row.iv,
    keyVersion: row.keyVersion,
    appName: row.appName,
    register: row.register,
    wordCount: row.wordCount,
    createdAt: row.createdAt,
  };
}

/** Real §7 queries. Encryption/HMAC already happened above; this only moves opaque bytes. */
export class DrizzleTranscriptRepo implements TranscriptRepo {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async insert(input: InsertTranscript): Promise<StoredTranscript> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(transcripts)
        .values({
          userId: input.userId,
          ciphertext: input.ciphertext,
          iv: input.iv,
          keyVersion: input.keyVersion,
          appName: input.appName,
          register: input.register,
          wordCount: input.wordCount,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) throw new Error('transcript insert returned no row');
      if (input.tokenHmacs.length > 0) {
        await tx
          .insert(transcriptTokens)
          .values(input.tokenHmacs.map((tokenHmac) => ({ transcriptId: row.id, tokenHmac })));
      }
      return toStored(row);
    });
  }

  async list(query: ListQuery): Promise<StoredTranscript[]> {
    const conds = [eq(transcripts.userId, query.userId)];

    if (query.cursor) {
      // Keyset: (created_at, id) strictly before the cursor under (created_at desc, id desc).
      const cursorCond = or(
        lt(transcripts.createdAt, query.cursor.createdAt),
        and(eq(transcripts.createdAt, query.cursor.createdAt), lt(transcripts.id, query.cursor.id)),
      );
      if (cursorCond) conds.push(cursorCond);
    }

    if (query.tokenHmacs && query.tokenHmacs.length > 0) {
      // AND semantics: keep transcripts that carry EVERY queried token. A transcript qualifies
      // iff it has `N` distinct matching token rows, where N = number of unique query tokens.
      const matching = this.db
        .select({ id: transcriptTokens.transcriptId })
        .from(transcriptTokens)
        .where(inArray(transcriptTokens.tokenHmac, query.tokenHmacs))
        .groupBy(transcriptTokens.transcriptId)
        .having(sql`count(distinct ${transcriptTokens.tokenHmac}) = ${query.tokenHmacs.length}`);
      conds.push(inArray(transcripts.id, matching));
    }

    const rows = await this.db
      .select()
      .from(transcripts)
      .where(and(...conds))
      .orderBy(desc(transcripts.createdAt), desc(transcripts.id))
      .limit(query.limit);
    return rows.map(toStored);
  }

  async get(userId: string, id: string): Promise<StoredTranscript | null> {
    const rows = await this.db
      .select()
      .from(transcripts)
      .where(and(eq(transcripts.userId, userId), eq(transcripts.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toStored(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    // transcript_tokens rows cascade-delete via their FK (§7 onDelete: cascade).
    const deleted = await this.db
      .delete(transcripts)
      .where(and(eq(transcripts.userId, userId), eq(transcripts.id, id)))
      .returning({ id: transcripts.id });
    return deleted.length > 0;
  }

  async deleteAll(userId: string): Promise<number> {
    const deleted = await this.db
      .delete(transcripts)
      .where(eq(transcripts.userId, userId))
      .returning({ id: transcripts.id });
    return deleted.length;
  }
}

// ── In-memory fake ───────────────────────────────────────────────────────────────────────────

interface FakeTokenRow {
  transcriptId: string;
  tokenHmac: Buffer;
}

/**
 * Deterministic in-memory repo for tests. Replicates the Drizzle ordering / keyset / AND-token
 * semantics exactly. `now` is injectable so pagination tests can assign controlled timestamps.
 * `rawTranscripts()` / `rawTokens()` expose the stored bytes so tests can PROVE no plaintext is
 * ever at rest.
 */
export class InMemoryTranscriptRepo implements TranscriptRepo {
  private readonly rows: StoredTranscript[] = [];
  private readonly tokens: FakeTokenRow[] = [];
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  insert(input: InsertTranscript): Promise<StoredTranscript> {
    const row: StoredTranscript = {
      id: randomUUID(),
      userId: input.userId,
      // Copy the buffers so a caller mutating its input cannot mutate stored state.
      ciphertext: Buffer.from(input.ciphertext),
      iv: Buffer.from(input.iv),
      keyVersion: input.keyVersion,
      appName: input.appName,
      register: input.register,
      wordCount: input.wordCount,
      createdAt: this.now(),
    };
    this.rows.push(row);
    for (const tokenHmac of input.tokenHmacs) {
      this.tokens.push({ transcriptId: row.id, tokenHmac: Buffer.from(tokenHmac) });
    }
    return Promise.resolve({ ...row });
  }

  list(query: ListQuery): Promise<StoredTranscript[]> {
    let candidates = this.rows.filter((r) => r.userId === query.userId);

    if (query.tokenHmacs && query.tokenHmacs.length > 0) {
      const wanted = query.tokenHmacs.map((b) => b.toString('hex'));
      candidates = candidates.filter((r) => {
        const have = new Set(
          this.tokens
            .filter((t) => t.transcriptId === r.id)
            .map((t) => t.tokenHmac.toString('hex')),
        );
        return wanted.every((w) => have.has(w));
      });
    }

    // Order newest-first: created_at desc, then id desc (matches the Drizzle ORDER BY).
    candidates.sort((a, b) => {
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    if (query.cursor) {
      const c = query.cursor;
      candidates = candidates.filter((r) => {
        const t = r.createdAt.getTime();
        const ct = c.createdAt.getTime();
        if (t !== ct) return t < ct;
        return r.id < c.id;
      });
    }

    return Promise.resolve(candidates.slice(0, query.limit).map((r) => ({ ...r })));
  }

  get(userId: string, id: string): Promise<StoredTranscript | null> {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    return Promise.resolve(row ? { ...row } : null);
  }

  delete(userId: string, id: string): Promise<boolean> {
    const idx = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (idx === -1) return Promise.resolve(false);
    this.rows.splice(idx, 1);
    this.pruneTokens(id);
    return Promise.resolve(true);
  }

  deleteAll(userId: string): Promise<number> {
    const removed = this.rows.filter((r) => r.userId === userId);
    for (const r of removed) this.pruneTokens(r.id);
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]?.userId === userId) this.rows.splice(i, 1);
    }
    return Promise.resolve(removed.length);
  }

  private pruneTokens(transcriptId: string): void {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      if (this.tokens[i]?.transcriptId === transcriptId) this.tokens.splice(i, 1);
    }
  }

  /** Test-only: every stored transcript row (encrypted bytes). */
  rawTranscripts(): readonly StoredTranscript[] {
    return this.rows;
  }

  /** Test-only: every stored token digest row. */
  rawTokens(): readonly { transcriptId: string; tokenHmac: Buffer }[] {
    return this.tokens;
  }
}
