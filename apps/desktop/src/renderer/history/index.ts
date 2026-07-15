// Public surface of the renderer history view (task 4b). The settings/main shell mounts
// `HistoryView`; the Phase-3 gate wires `RestHistoryApi` with a real `TokenProvider` bearer.
export { HistoryView, type HistoryViewProps } from './HistoryView';
export { HistoryItemRow, type HistoryItemRowProps } from './HistoryItemRow';
export {
  type HistoryApi,
  type HistoryListParams,
  type HistoryListResult,
  type HistoryApiErrorKind,
  HistoryApiError,
} from './history-api';
export {
  FakeHistoryApi,
  type FakeHistoryApiOptions,
  wordsOf,
  matchesQuery,
} from './fake-history-api';
export {
  RestHistoryApi,
  type RestHistoryApiDeps,
  type TokenProvider,
  type FetchFn,
} from './rest-history-api';
export {
  useHistory,
  type UseHistory,
  type HistoryPhase,
  type HistoryErrorState,
} from './useHistory';
export { useDebouncedValue } from './useDebouncedValue';
export { relativeTime, absoluteTime } from './relative-time';
export { CLEAR_ALL_CONFIRM_WORD, SEARCH_PLACEHOLDER } from './history-copy';
export { HISTORY_CSS, HISTORY_STYLE_ID } from './history-styles';
