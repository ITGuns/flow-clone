// Formatter — CONTRACTS.md §2.2. One call per utterance. HaikuFormatter (apps/api) and
// MockFormatter (Phase 1) implement this; the golden set enforces the §6 formatting rules.
import type { FormatRequest, FormatResult } from './types';

export interface Formatter {
  /** One call per utterance. Yields text deltas in order; return value is the assembled result. */
  format(req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult>;
}
