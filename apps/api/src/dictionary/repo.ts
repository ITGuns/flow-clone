// Dictionary persistence port — CONTRACTS §7 (`dictionary` table, UNIQUE(user_id, lower(phrase))).
//
// The service (store.ts) owns the HTTP-error semantics (400/404/409/422); this port owns *only*
// row access. Two implementations:
//   • InMemoryDictionaryRepo — deterministic fake for unit tests (models the UNIQUE index by
//     throwing DuplicatePhraseError on a case-insensitive collision, exactly as Postgres would).
//   • DrizzleDictionaryRepo — real impl over the §7 table; targets the real functional unique
//     index and maps Postgres error codes (23505 unique-violation, 22P02 malformed-uuid) onto the
//     same port contract the fake presents, so the service stays storage-agnostic.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { dictionary, type DictionaryRow, type NewDictionaryRow, type schema } from '../db';

/** Fields a PATCH may set on an existing row. Absent keys are left untouched. */
export interface DictionaryPatch {
  phrase?: string;
  soundsLike?: string[];
}

/**
 * Thrown by a repo `insert`/`updateForUser` when a row would violate the case-insensitive
 * UNIQUE(user_id, lower(phrase)) index. The service maps this to HTTP 409. It is a distinct
 * type (not a generic Error) so the service can catch the constraint race without string-matching.
 */
export class DuplicatePhraseError extends Error {
  constructor(message = 'phrase already exists for this user') {
    super(message);
    this.name = 'DuplicatePhraseError';
  }
}

/**
 * Row-level access to the `dictionary` table, scoped by user. All mutations are owner-scoped:
 * `updateForUser`/`deleteForUser`/`findByIdForUser` return undefined/false when the id does not
 * belong to `userId`, which the service surfaces as 404 (never leaking another user's rows).
 */
export interface DictionaryRepo {
  listByUser(userId: string): Promise<DictionaryRow[]>;
  countByUser(userId: string): Promise<number>;
  /** Find a row by case-insensitive phrase match within a user (backs the dup pre-check). */
  findByUserAndLowerPhrase(userId: string, phrase: string): Promise<DictionaryRow | undefined>;
  /** Insert a fully-specified row. Throws {@link DuplicatePhraseError} on a uniqueness collision. */
  insert(row: NewDictionaryRow): Promise<DictionaryRow>;
  findByIdForUser(id: string, userId: string): Promise<DictionaryRow | undefined>;
  /** Apply a patch to an owned row. undefined when absent/not-owned; throws on uniqueness collision. */
  updateForUser(
    id: string,
    userId: string,
    patch: DictionaryPatch,
  ): Promise<DictionaryRow | undefined>;
  deleteForUser(id: string, userId: string): Promise<boolean>;
}

// ── In-memory fake ────────────────────────────────────────────────────────────────────────────

const lower = (s: string): string => s.toLowerCase();

/** Deterministic, dependency-free {@link DictionaryRepo} for unit tests. */
export class InMemoryDictionaryRepo implements DictionaryRepo {
  private readonly rows: DictionaryRow[] = [];

  listByUser(userId: string): Promise<DictionaryRow[]> {
    const mine = this.rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(mine.map((r) => ({ ...r })));
  }

  countByUser(userId: string): Promise<number> {
    return Promise.resolve(this.rows.filter((r) => r.userId === userId).length);
  }

  findByUserAndLowerPhrase(userId: string, phrase: string): Promise<DictionaryRow | undefined> {
    const found = this.rows.find((r) => r.userId === userId && lower(r.phrase) === lower(phrase));
    return Promise.resolve(found ? { ...found } : undefined);
  }

  insert(row: NewDictionaryRow): Promise<DictionaryRow> {
    const full: DictionaryRow = {
      id: row.id ?? randomUUID(),
      userId: row.userId,
      phrase: row.phrase,
      soundsLike: row.soundsLike ?? [],
      createdAt: row.createdAt ?? new Date(),
    };
    const collision = this.rows.some(
      (r) => r.userId === full.userId && lower(r.phrase) === lower(full.phrase),
    );
    if (collision) return Promise.reject(new DuplicatePhraseError());
    this.rows.push(full);
    return Promise.resolve({ ...full });
  }

  findByIdForUser(id: string, userId: string): Promise<DictionaryRow | undefined> {
    const found = this.rows.find((r) => r.id === id && r.userId === userId);
    return Promise.resolve(found ? { ...found } : undefined);
  }

  updateForUser(
    id: string,
    userId: string,
    patch: DictionaryPatch,
  ): Promise<DictionaryRow | undefined> {
    const row = this.rows.find((r) => r.id === id && r.userId === userId);
    if (!row) return Promise.resolve(undefined);
    if (patch.phrase !== undefined) {
      const collision = this.rows.some(
        (r) =>
          r.userId === userId && r.id !== id && lower(r.phrase) === lower(patch.phrase as string),
      );
      if (collision) return Promise.reject(new DuplicatePhraseError());
      row.phrase = patch.phrase;
    }
    if (patch.soundsLike !== undefined) row.soundsLike = patch.soundsLike;
    return Promise.resolve({ ...row });
  }

  deleteForUser(id: string, userId: string): Promise<boolean> {
    const idx = this.rows.findIndex((r) => r.id === id && r.userId === userId);
    if (idx === -1) return Promise.resolve(false);
    this.rows.splice(idx, 1);
    return Promise.resolve(true);
  }
}

// ── Drizzle (Postgres) impl ─────────────────────────────────────────────────────────────────────

/** Postgres SQLSTATE for a unique_violation (fires on the UNIQUE(user_id, lower(phrase)) index). */
const PG_UNIQUE_VIOLATION = '23505';
/** Postgres SQLSTATE for invalid_text_representation — e.g. a non-UUID :id in the path. */
const PG_INVALID_TEXT = '22P02';

function pgCode(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Real repo over the §7 `dictionary` table. Uniqueness is still enforced by the DB's functional
 * unique index — a concurrent insert that races past the service's pre-check surfaces here as
 * {@link DuplicatePhraseError} (SQLSTATE 23505). A malformed (non-UUID) id is treated as "not
 * found" (SQLSTATE 22P02 → undefined/false) rather than a 500.
 */
export class DrizzleDictionaryRepo implements DictionaryRepo {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async listByUser(userId: string): Promise<DictionaryRow[]> {
    return this.db
      .select()
      .from(dictionary)
      .where(eq(dictionary.userId, userId))
      .orderBy(asc(dictionary.createdAt), asc(dictionary.id));
  }

  async countByUser(userId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(dictionary)
      .where(eq(dictionary.userId, userId));
    return rows[0]?.count ?? 0;
  }

  async findByUserAndLowerPhrase(
    userId: string,
    phrase: string,
  ): Promise<DictionaryRow | undefined> {
    const rows = await this.db
      .select()
      .from(dictionary)
      .where(
        and(eq(dictionary.userId, userId), sql`lower(${dictionary.phrase}) = lower(${phrase})`),
      )
      .limit(1);
    return rows[0];
  }

  async insert(row: NewDictionaryRow): Promise<DictionaryRow> {
    try {
      const inserted = await this.db.insert(dictionary).values(row).returning();
      // `returning()` on a single-row insert always yields exactly one row.
      return inserted[0] as DictionaryRow;
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new DuplicatePhraseError();
      throw err;
    }
  }

  async findByIdForUser(id: string, userId: string): Promise<DictionaryRow | undefined> {
    try {
      const rows = await this.db
        .select()
        .from(dictionary)
        .where(and(eq(dictionary.id, id), eq(dictionary.userId, userId)))
        .limit(1);
      return rows[0];
    } catch (err) {
      if (pgCode(err) === PG_INVALID_TEXT) return undefined;
      throw err;
    }
  }

  async updateForUser(
    id: string,
    userId: string,
    patch: DictionaryPatch,
  ): Promise<DictionaryRow | undefined> {
    // Nothing to set → return the current row (owner-scoped) unchanged. The service guarantees a
    // non-empty patch, so this is just a defensive no-op that avoids an empty SET clause.
    if (patch.phrase === undefined && patch.soundsLike === undefined) {
      return this.findByIdForUser(id, userId);
    }
    try {
      const updated = await this.db
        .update(dictionary)
        .set({
          ...(patch.phrase !== undefined ? { phrase: patch.phrase } : {}),
          ...(patch.soundsLike !== undefined ? { soundsLike: patch.soundsLike } : {}),
        })
        .where(and(eq(dictionary.id, id), eq(dictionary.userId, userId)))
        .returning();
      return updated[0];
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new DuplicatePhraseError();
      if (pgCode(err) === PG_INVALID_TEXT) return undefined;
      throw err;
    }
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    try {
      const deleted = await this.db
        .delete(dictionary)
        .where(and(eq(dictionary.id, id), eq(dictionary.userId, userId)))
        .returning({ id: dictionary.id });
      return deleted.length > 0;
    } catch (err) {
      if (pgCode(err) === PG_INVALID_TEXT) return false;
      throw err;
    }
  }
}
