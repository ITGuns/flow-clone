// Dictionary module surface (Task 3d). The composition root builds a DictionaryStore over the
// DrizzleDictionaryRepo (real) or InMemoryDictionaryRepo (tests), registers the routes, and hands
// `loadDictionaryForUser` to the Phase 3 format-pipeline gate.
export { DuplicatePhraseError, InMemoryDictionaryRepo, DrizzleDictionaryRepo } from './repo';
export type { DictionaryRepo, DictionaryPatch } from './repo';
export {
  DictionaryStore,
  DictionaryError,
  MAX_DICTIONARY_ENTRIES,
  loadDictionaryForUser,
} from './store';
export type { DictionaryErrorCode, DictionaryStoreOptions, DictionaryDeps } from './store';
export { registerDictionaryRoutes } from '../routes/dictionary';
export type { DictionaryRoutesDeps } from '../routes/dictionary';
