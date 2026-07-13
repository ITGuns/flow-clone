// Golden-set types — CONTRACTS §6 as data. A GoldenCase is a frozen (input → expected)
// pair plus the context a Formatter needs to produce `expected` from `input`. These are the
// units the scoring harness runs any Formatter implementation against.
import type { AppContext, DictionaryEntry } from '../types';

/**
 * How a case is scored:
 * - `command`: normalized EXACT match (the §4.3 grammar is mechanical; there is one right
 *   answer). Every command case is mock-passable — derivable from the rule set documented in
 *   `loader.ts`.
 * - `prose`: fuzzy similarity (lexical F1 now; embedding later — see `scorer.ts`). Judges
 *   whether the formatter landed close enough to the intended polish, not byte-identical.
 */
export type GoldenKind = 'command' | 'prose';

export interface GoldenCase {
  /** Unique across the whole set; used in reports and as the dedup key at load. */
  id: string;
  kind: GoldenKind;
  /**
   * `true` marks a case a rule-based mock is NOT required to pass — register adaptation,
   * false-start repair, ambiguous command-vs-prose, dictionary substitution. The harness
   * excludes these unless `runGoldenSet` is called with `includeHaikuOnly: true`.
   */
  haikuOnly: boolean;
  /** Realistic raw ASR: lowercase, unpunctuated, disfluent where the case calls for it. */
  input: string;
  appContext: AppContext;
  /** Included inline so a case is self-contained; already capped/filtered per §6. */
  dictionary: DictionaryEntry[];
  /** The ground-truth polished output. */
  expected: string;
}
