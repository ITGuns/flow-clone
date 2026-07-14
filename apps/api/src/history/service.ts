// persistTranscript — the single entry point the Phase 3 gate wires into the WS pipeline at
// `format.done`. Kept as a thin, dependency-injected function so the orchestrator can call it
// without touching pipeline.ts internals: the gate holds a built TranscriptStore and forwards the
// finalized text + context here. Audio is never involved.
import type { HistoryItem, Register } from '@undertone/shared';
import type { TranscriptStore } from './store';

/** What the gate passes to {@link persistTranscript}: just the store. */
export interface PersistTranscriptDeps {
  store: TranscriptStore;
}

/** The finalized-utterance fields available at `format.done` (§4.3 `format.done` + §7 columns). */
export interface PersistTranscriptInput {
  userId: string;
  text: string;
  appName: string;
  register: Register;
  wordCount: number;
}

/**
 * Encrypt-and-store one finalized transcript, returning its HistoryItem. Called at `format.done`
 * by the pipeline (wired at the Phase 3 gate). Never persists audio.
 */
export function persistTranscript(
  deps: PersistTranscriptDeps,
  input: PersistTranscriptInput,
): Promise<HistoryItem> {
  return deps.store.persist(input);
}
