// In-memory DictionaryApi for the Settings UI tests (task 4c). Not a `.test` file. Mirrors the
// CONTRACTS.md §5 error semantics the UI must handle: 409 on a duplicate phrase (case-insensitive,
// matching the DB's UNIQUE(user_id, lower(phrase)) index), 422 when the 500-entry cap is hit, 404 on
// an unknown id. A configurable `cap` keeps the 422 path cheap to test without inserting 500 rows.
import type { DictionaryEntry } from '@undertone/shared';
import {
  DictionaryApiError,
  type DictionaryApi,
  type DictionaryCreateInput,
  type DictionaryUpdateInput,
} from './dictionary-api';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export class FakeDictionaryApi implements DictionaryApi {
  private entries: DictionaryEntry[];
  private readonly cap: number;

  constructor(init: { entries?: DictionaryEntry[]; cap?: number } = {}) {
    this.entries = init.entries ? [...init.entries] : [];
    this.cap = init.cap ?? 500;
  }

  list(): Promise<DictionaryEntry[]> {
    return Promise.resolve(this.entries.map((e) => ({ ...e })));
  }

  create(input: DictionaryCreateInput): Promise<DictionaryEntry> {
    const phrase = input.phrase.trim();
    if (phrase === '') {
      return Promise.reject(new DictionaryApiError('bad-request', 'phrase required', 400));
    }
    if (this.entries.length >= this.cap) {
      return Promise.reject(new DictionaryApiError('cap', 'dictionary full', 422));
    }
    if (this.hasPhrase(phrase)) {
      return Promise.reject(new DictionaryApiError('duplicate', 'duplicate phrase', 409));
    }
    const entry: DictionaryEntry = {
      id: nextId(),
      phrase,
      soundsLike: input.soundsLike ?? [],
      createdAt: new Date(0).toISOString(),
    };
    this.entries = [...this.entries, entry];
    return Promise.resolve({ ...entry });
  }

  update(id: string, patch: DictionaryUpdateInput): Promise<DictionaryEntry> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      return Promise.reject(new DictionaryApiError('not-found', 'no such entry', 404));
    }
    const existing = this.entries[idx]!;
    const nextPhrase = patch.phrase !== undefined ? patch.phrase.trim() : existing.phrase;
    if (nextPhrase === '') {
      return Promise.reject(new DictionaryApiError('bad-request', 'phrase required', 400));
    }
    if (patch.phrase !== undefined && this.hasPhrase(nextPhrase, id)) {
      return Promise.reject(new DictionaryApiError('duplicate', 'rename collides', 409));
    }
    const updated: DictionaryEntry = {
      ...existing,
      phrase: nextPhrase,
      soundsLike: patch.soundsLike ?? existing.soundsLike,
    };
    this.entries = this.entries.map((e) => (e.id === id ? updated : e));
    return Promise.resolve({ ...updated });
  }

  remove(id: string): Promise<void> {
    const exists = this.entries.some((e) => e.id === id);
    if (!exists) {
      return Promise.reject(new DictionaryApiError('not-found', 'no such entry', 404));
    }
    this.entries = this.entries.filter((e) => e.id !== id);
    return Promise.resolve();
  }

  private hasPhrase(phrase: string, exceptId?: string): boolean {
    const needle = phrase.toLowerCase();
    return this.entries.some((e) => e.id !== exceptId && e.phrase.toLowerCase() === needle);
  }
}
