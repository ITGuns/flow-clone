// Public surface of the Settings renderer module (task 4c). The Phase 4 gate wires the real ports
// (an IPC-backed SettingsBridge and the REST dictionary api + native isSupported) and mounts
// `SettingsView`; everything below is fake-backed and testable in isolation.
export { SettingsView, type SettingsViewProps } from './SettingsView';
export { HotkeyRecorder, type HotkeyRecorderProps } from './HotkeyRecorder';
export { DictionaryManager, type DictionaryManagerProps } from './DictionaryManager';
export { PreferencesPanel, type PreferencesPanelProps } from './PreferencesPanel';
export { TagInput, type TagInputProps } from './TagInput';
export { SettingsStyles } from './SettingsStyles';

export type { SettingsBridge } from './settings-bridge';
export { FakeSettingsBridge } from './fake-settings-bridge';

export {
  DictionaryApiError,
  dictionaryErrorMessage,
  type DictionaryApi,
  type DictionaryCreateInput,
  type DictionaryUpdateInput,
  type DictionaryErrorKind,
} from './dictionary-api';
export { FakeDictionaryApi } from './fake-dictionary-api';
export {
  RestDictionaryApi,
  type RestDictionaryApiOptions,
  type FetchLike,
  type FetchInit,
  type FetchResponse,
} from './rest-dictionary-api';

export {
  acceleratorFromEvent,
  describeHotkeyConflict,
  type KeyLikeEvent,
} from './accelerator-capture';
