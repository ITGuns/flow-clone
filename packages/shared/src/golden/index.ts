// Golden set — public surface. The frozen (input → expected) fixtures plus the Formatter-
// agnostic scoring harness (CONTRACTS §6). Re-exported from @undertone/shared.
export type { GoldenCase, GoldenKind } from './types';
export { loadGoldenSet } from './loader';
export {
  normalize,
  commandMatches,
  lexicalF1,
  lexicalProseScorer,
  type ProseScorer,
} from './scorer';
export {
  runGoldenSet,
  type GoldenReport,
  type GoldenCaseResult,
  type RunGoldenSetOptions,
} from './runner';
