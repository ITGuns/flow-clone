// Scoring — CONTRACTS §6. Two regimes:
//   command → normalized EXACT match
//   prose   → keyless local lexical similarity (token-level F1), threshold 0.85
//
// The prose regime is intentionally an interface (`ProseScorer`) so an `EmbeddingScorer`
// (CONTRACTS §6, threshold 0.90) can slot in unchanged once an API key exists. Only the
// lexical scorer is implemented now; the seam is marked below.

/**
 * Normalization canon — shared verbatim with task 1e's MockFormatter, DO NOT diverge:
 * trim, collapse whitespace runs to one space, unify curly quotes to straight.
 */
export function normalize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'") // curly/low singles → '
    .replace(/[“”„‟]/g, '"') // curly/low doubles → "
    .replace(/\s+/g, ' ')
    .trim();
}

/** command scoring: normalized exact match. */
export function commandMatches(expected: string, actual: string): boolean {
  return normalize(expected) === normalize(actual);
}

/**
 * Prose tokenization: normalize, lowercase, then take maximal runs of letters/digits
 * (apostrophes kept intra-word). Punctuation is a separator, so trailing "." / "," never
 * skews the token bag.
 */
function tokenize(text: string): string[] {
  const lowered = normalize(text).toLowerCase();
  return lowered.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

function bag(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tok of tokens) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  return counts;
}

/**
 * Token-level F1 over the multiset of tokens (overlap = sum of per-token min counts).
 * Both empty → 1 (two blanks agree); exactly one empty → 0. Range [0, 1].
 */
export function lexicalF1(expected: string, actual: string): number {
  const exp = tokenize(expected);
  const act = tokenize(actual);
  if (exp.length === 0 && act.length === 0) return 1;
  if (exp.length === 0 || act.length === 0) return 0;

  const expBag = bag(exp);
  const actBag = bag(act);
  let overlap = 0;
  for (const [tok, count] of expBag) overlap += Math.min(count, actBag.get(tok) ?? 0);
  if (overlap === 0) return 0;

  const precision = overlap / act.length;
  const recall = overlap / exp.length;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Prose scorer seam. A scorer maps (expected, actual) → similarity in [0, 1] and declares the
 * pass threshold. `score` may be async so a network-backed embedding scorer fits without
 * touching the runner.
 */
export interface ProseScorer {
  readonly id: string;
  readonly threshold: number;
  score(expected: string, actual: string): number | Promise<number>;
}

/** Default keyless scorer: token-level F1, threshold 0.85. */
export const lexicalProseScorer: ProseScorer = {
  id: 'lexical-f1',
  threshold: 0.85,
  score: lexicalF1,
};

// SEAM — EmbeddingScorer (CONTRACTS §6, threshold 0.90): implement `ProseScorer` with
// `score()` calling an embeddings endpoint (cosine similarity) and pass it to `runGoldenSet`
// via `opts.proseScorer` when an API key is present. No other harness change is required.
