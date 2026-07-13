// Core domain types — CONTRACTS.md §1. These shapes are law; imported, never redeclared.

export type UtteranceId = number; // u16, per-session monotonic, starts at 1
export type SessionId = string; // UUIDv4, client-generated per WS connection

export interface AppContext {
  bundleId: string; // mac bundle id / win executable name, e.g. "com.tinyspeck.slackmacgap" | "slack.exe"
  appName: string; // human name, "Slack"
  windowTitle: string; // may be ""; truncate to 256 chars
  register: Register; // derived client-side via packages/shared/src/register-map.ts
}
export type Register = 'chat' | 'email' | 'code' | 'document' | 'terminal' | 'unknown';

export interface DictionaryEntry {
  id: string; // UUIDv4
  phrase: string; // what the user means, e.g. "Kubernetes"
  soundsLike: string[]; // optional ASR mishearings, e.g. ["cooper netties"]
  createdAt: string; // ISO 8601
}

export interface FormatRequest {
  transcript: string; // finalized ASR text
  appContext: AppContext;
  dictionary: DictionaryEntry[]; // ALREADY capped/filtered per §6 rules
  locale: string; // BCP-47, "en-US" v1
}

export interface FormatResult {
  text: string; // final formatted text (concatenation of all deltas)
  wordCount: number; // whitespace-split of `text`; THE metering unit
  commandsApplied: string[]; // which §4.3 grammar commands fired (for telemetry counts only)
}

// REST payload — CONTRACTS.md §5.
export interface HistoryItem {
  id: string;
  text: string; // decrypted server-side for the owner
  appName: string;
  register: Register;
  wordCount: number;
  createdAt: string;
}
