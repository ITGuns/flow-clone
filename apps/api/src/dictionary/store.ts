// Dictionary service — CONTRACTS §5 (REST error semantics), §6 (loader boundary), §7 (storage).
//
// Owns the HTTP-error contract for dictionary CRUD, independent of transport:
//   • 400 BAD_BODY        — malformed create/update payload
//   • 404 NOT_FOUND       — id absent or not owned by the caller
//   • 409 DUPLICATE_PHRASE — case-insensitive phrase collision (UNIQUE(user_id, lower(phrase)))
//   • 422 CAP_EXCEEDED    — user already at the 500-entry cap
// Uniqueness and the cap are enforced HERE (pre-checks), with the repo's DuplicatePhraseError as
// a race backstop — never relying on a raw DB throw for the common path (per task spec).
//
// The loader boundary (§6): `loadDictionaryForUser` returns the user's FULL entry list. It does
// NOT apply the §6 cap/trigram filter — that is @undertone/shared `filterDictionary`, which the
// gateway pipeline runs against the finalized transcript just before building the Haiku prompt.
// Keeping filtering out of the loader means the cap logic lives in exactly one place (shared).
import { randomUUID } from 'node:crypto';
import type { DictionaryEntry } from '@undertone/shared';
import type { DictionaryRow, NewDictionaryRow } from '../db';
import { DuplicatePhraseError, type DictionaryPatch, type DictionaryRepo } from './repo';

/** §5: `422 (>500 entries total)`. A user may hold at most this many entries. */
export const MAX_DICTIONARY_ENTRIES = 500;

/** The set of client-error conditions the dictionary API can surface. */
export type DictionaryErrorCode = 'BAD_BODY' | 'NOT_FOUND' | 'DUPLICATE_PHRASE' | 'CAP_EXCEEDED';

/**
 * A dictionary operation failed with a client-visible condition. Carries the exact HTTP status
 * the §5 table prescribes so the route layer is a thin translator (never re-deriving statuses).
 */
export class DictionaryError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: DictionaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DictionaryError';
  }
}

/** Injectable clock + id generator (defaults are production values; overridden in tests). */
export interface DictionaryStoreOptions {
  uuid?: () => string;
  now?: () => Date;
}

interface ValidCreate {
  phrase: string;
  soundsLike: string[];
}

/** Map a persisted row to the §1 `DictionaryEntry` wire shape (drops user_id, ISO-formats time). */
function toEntry(row: DictionaryRow): DictionaryEntry {
  return {
    id: row.id,
    phrase: row.phrase,
    soundsLike: row.soundsLike,
    createdAt: row.createdAt.toISOString(),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Validate & normalize a soundsLike input: must be a string[]; trims and drops blanks. */
function normalizeSoundsLike(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new DictionaryError(400, 'BAD_BODY', 'soundsLike must be an array of strings');
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new DictionaryError(400, 'BAD_BODY', 'soundsLike must contain only strings');
    }
    const trimmed = item.trim();
    if (trimmed !== '') out.push(trimmed);
  }
  return out;
}

/** Parse a POST body into a validated create input, or throw a 400. */
function parseCreateBody(body: unknown): ValidCreate {
  if (!isRecord(body)) {
    throw new DictionaryError(400, 'BAD_BODY', 'body must be a JSON object');
  }
  const { phrase, soundsLike } = body;
  if (typeof phrase !== 'string' || phrase.trim() === '') {
    throw new DictionaryError(400, 'BAD_BODY', 'phrase is required and must be a non-empty string');
  }
  return {
    phrase: phrase.trim(),
    soundsLike: soundsLike === undefined ? [] : normalizeSoundsLike(soundsLike),
  };
}

/** Parse a PATCH body into a non-empty patch, or throw a 400. */
function parseUpdateBody(body: unknown): DictionaryPatch {
  if (!isRecord(body)) {
    throw new DictionaryError(400, 'BAD_BODY', 'body must be a JSON object');
  }
  const patch: DictionaryPatch = {};
  if ('phrase' in body && body.phrase !== undefined) {
    if (typeof body.phrase !== 'string' || body.phrase.trim() === '') {
      throw new DictionaryError(400, 'BAD_BODY', 'phrase must be a non-empty string');
    }
    patch.phrase = body.phrase.trim();
  }
  if ('soundsLike' in body && body.soundsLike !== undefined) {
    patch.soundsLike = normalizeSoundsLike(body.soundsLike);
  }
  if (patch.phrase === undefined && patch.soundsLike === undefined) {
    throw new DictionaryError(400, 'BAD_BODY', 'patch must set at least one of phrase, soundsLike');
  }
  return patch;
}

/**
 * User-scoped dictionary CRUD. Every method is owner-scoped by `userId`; ids belonging to other
 * users are indistinguishable from missing ones (both → 404), so no cross-user existence leaks.
 */
export class DictionaryStore {
  private readonly uuid: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly repo: DictionaryRepo,
    options: DictionaryStoreOptions = {},
  ) {
    this.uuid = options.uuid ?? randomUUID;
    this.now = options.now ?? ((): Date => new Date());
  }

  /** GET /v1/dictionary — the user's full entry list (order stable by createdAt). */
  async list(userId: string): Promise<DictionaryEntry[]> {
    const rows = await this.repo.listByUser(userId);
    return rows.map(toEntry);
  }

  /** POST /v1/dictionary — create. Throws DictionaryError(400 | 409 | 422). */
  async create(userId: string, body: unknown): Promise<DictionaryEntry> {
    const input = parseCreateBody(body);

    // §5 cap: enforced before insert so we return 422 rather than let the row land.
    const count = await this.repo.countByUser(userId);
    if (count >= MAX_DICTIONARY_ENTRIES) {
      throw new DictionaryError(
        422,
        'CAP_EXCEEDED',
        `dictionary is full (max ${MAX_DICTIONARY_ENTRIES} entries)`,
      );
    }

    // §5 dup: case-insensitive pre-check for a friendly 409; the DB unique index is the backstop.
    const existing = await this.repo.findByUserAndLowerPhrase(userId, input.phrase);
    if (existing) {
      throw new DictionaryError(409, 'DUPLICATE_PHRASE', 'phrase already exists');
    }

    const row: NewDictionaryRow = {
      id: this.uuid(),
      userId,
      phrase: input.phrase,
      soundsLike: input.soundsLike,
      createdAt: this.now(),
    };
    try {
      const inserted = await this.repo.insert(row);
      return toEntry(inserted);
    } catch (err) {
      if (err instanceof DuplicatePhraseError) {
        throw new DictionaryError(409, 'DUPLICATE_PHRASE', 'phrase already exists');
      }
      throw err;
    }
  }

  /** PATCH /v1/dictionary/:id — partial update. Throws DictionaryError(400 | 404 | 409). */
  async update(userId: string, id: string, body: unknown): Promise<DictionaryEntry> {
    const patch = parseUpdateBody(body);
    try {
      const updated = await this.repo.updateForUser(id, userId, patch);
      if (!updated) {
        throw new DictionaryError(404, 'NOT_FOUND', 'dictionary entry not found');
      }
      return toEntry(updated);
    } catch (err) {
      if (err instanceof DuplicatePhraseError) {
        throw new DictionaryError(409, 'DUPLICATE_PHRASE', 'phrase already exists');
      }
      throw err;
    }
  }

  /** DELETE /v1/dictionary/:id. Throws DictionaryError(404) when absent/not owned. */
  async delete(userId: string, id: string): Promise<void> {
    const ok = await this.repo.deleteForUser(id, userId);
    if (!ok) {
      throw new DictionaryError(404, 'NOT_FOUND', 'dictionary entry not found');
    }
  }
}

/** Dependencies the format-pipeline gate needs to load a user's dictionary. */
export interface DictionaryDeps {
  store: DictionaryStore;
}

/**
 * Load a user's FULL dictionary for prompt injection — the seam the Phase 3 gate calls before
 * formatting. Returns every entry, UNFILTERED; the gateway pipeline then passes the result through
 * @undertone/shared `filterDictionary(entries, transcript)` (§6 cap/trigram) before building the
 * Haiku prompt. This function deliberately does not filter — filtering needs the transcript, which
 * is not known at load time, and the §6 cap logic lives once, in shared.
 */
export function loadDictionaryForUser(
  deps: DictionaryDeps,
  userId: string,
): Promise<DictionaryEntry[]> {
  return deps.store.list(userId);
}
