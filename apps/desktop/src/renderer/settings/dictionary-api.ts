// The dictionary port the Settings UI drives, mapping 1:1 onto CONTRACTS.md §5's REST surface:
//   GET    /v1/dictionary        → list
//   POST   /v1/dictionary        → create   (409 dup phrase, 422 > 500 entries total)
//   PATCH  /v1/dictionary/:id     → update   (404 missing, 409 rename collision)
//   DELETE /v1/dictionary/:id     → remove   (404 missing)
// The UI depends only on this interface + `DictionaryApiError` — `FakeDictionaryApi` backs the
// component tests, `RestDictionaryApi` (rest-dictionary-api.ts) is the production impl. `DictionaryEntry`
// is imported from @undertone/shared and never redeclared.
import type { DictionaryEntry } from '@undertone/shared';

export interface DictionaryCreateInput {
  phrase: string;
  soundsLike?: string[];
}
export interface DictionaryUpdateInput {
  phrase?: string;
  soundsLike?: string[];
}

export interface DictionaryApi {
  list(): Promise<DictionaryEntry[]>;
  create(input: DictionaryCreateInput): Promise<DictionaryEntry>;
  update(id: string, patch: DictionaryUpdateInput): Promise<DictionaryEntry>;
  remove(id: string): Promise<void>;
}

/**
 * Normalized failure kinds the UI renders inline. Mapped from HTTP status by `RestDictionaryApi`
 * and produced directly by `FakeDictionaryApi`:
 * - `duplicate`    409 — phrase already exists (create) or a rename collides (update).
 * - `cap`          422 — the >500-entry total cap (create).
 * - `not-found`    404 — update/delete of an unknown id.
 * - `bad-request`  400 — empty/invalid phrase.
 * - `unauthorized` 401 — auth expired/invalid.
 * - `network`      transport failure (fetch rejected / non-JSON).
 * - `unknown`      any other status.
 */
export type DictionaryErrorKind =
  | 'duplicate'
  | 'cap'
  | 'not-found'
  | 'bad-request'
  | 'unauthorized'
  | 'network'
  | 'unknown';

export class DictionaryApiError extends Error {
  readonly kind: DictionaryErrorKind;
  readonly status?: number;
  constructor(kind: DictionaryErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'DictionaryApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Human-readable, honest copy per failure kind — used by the Dictionary UI. */
export function dictionaryErrorMessage(err: DictionaryApiError): string {
  switch (err.kind) {
    case 'duplicate':
      return 'You already have that phrase in your dictionary.';
    case 'cap':
      // Honest about the real limit rather than a vague "try again".
      return 'Your dictionary is full (500 entries max). Remove one before adding another.';
    case 'not-found':
      return 'That entry no longer exists — it may have been removed elsewhere.';
    case 'bad-request':
      return 'Enter a phrase before saving.';
    case 'unauthorized':
      return 'Your session expired. Sign in again to manage your dictionary.';
    case 'network':
      return 'Could not reach the server. Check your connection and try again.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}
