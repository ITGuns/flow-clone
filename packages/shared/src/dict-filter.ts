// Dictionary filter — CONTRACTS.md §6. Pure, dependency-free. Decides which DictionaryEntry
// lines make it into the Haiku prompt so the dictionary block stays inside the §6 cap
// (≤200 entries / ~2k tokens); beyond the cap it keeps only entries whose phrase (or any
// soundsLike mishearing) fuzzily occurs in the transcript.
import type { DictionaryEntry } from './types';

/** §6 cap: entry count. Inclusive — exactly 200 entries still pass through untouched. */
export const DICT_MAX_ENTRIES = 200;

/** §6 cap: ~2k estimated tokens for the rendered dictionary block. Inclusive. */
export const DICT_MAX_TOKENS = 2000;

/** §6 fuzzy-match threshold for the over-cap path. */
export const DICT_TRIGRAM_THRESHOLD = 0.4;

/** Token estimate heuristic: ~4 characters per token (CONTRACTS §6 / ARCHITECTURE §4). */
const CHARS_PER_TOKEN = 4;

/**
 * Estimated token cost of rendering these entries into the prompt's dictionary block.
 * Sums the characters of every phrase and soundsLike variant and divides by the 4-chars/token
 * heuristic. Deliberately ignores the fixed "(may be misheard as: …)" scaffolding — it is the
 * user-supplied content that scales, and the estimate only needs to bound the cap decision.
 */
export function estimateDictionaryTokens(entries: readonly DictionaryEntry[]): number {
  let chars = 0;
  for (const entry of entries) {
    chars += entry.phrase.length;
    for (const variant of entry.soundsLike) chars += variant.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Trigram set of a string: lowercased, whitespace collapsed, then every length-3 substring.
 * Strings shorter than 3 normalized characters yield the empty set.
 */
function trigrams(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= normalized.length; i++) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

/**
 * Trigram similarity of a short `query` against a longer `text`, defined as containment:
 * the fraction of the query's trigrams that also appear in the text. This is the
 * "does this term fuzzily occur in the transcript" measure — Jaccard would collapse to ~0
 * for a short phrase inside a long transcript, so containment is the right shape for the
 * §6 threshold. Returns 0 when the query has no trigrams (fewer than 3 normalized chars),
 * so such entries are dropped on the over-cap path unless another field matches.
 */
export function trigramSimilarity(query: string, text: string): number {
  const queryGrams = trigrams(query);
  if (queryGrams.size === 0) return 0;
  const textGrams = trigrams(text);
  let overlap = 0;
  for (const gram of queryGrams) {
    if (textGrams.has(gram)) overlap += 1;
  }
  return overlap / queryGrams.size;
}

/** True when an entry's phrase or any soundsLike variant clears the similarity threshold. */
function entryMatchesTranscript(entry: DictionaryEntry, transcript: string): boolean {
  if (trigramSimilarity(entry.phrase, transcript) >= DICT_TRIGRAM_THRESHOLD) return true;
  return entry.soundsLike.some(
    (variant) => trigramSimilarity(variant, transcript) >= DICT_TRIGRAM_THRESHOLD,
  );
}

/**
 * §6 dictionary filter. If the set is within BOTH caps (≤200 entries AND ≤~2k estimated
 * tokens) it passes through unchanged (a fresh array). Otherwise only entries that fuzzily
 * occur in the transcript (trigram similarity ≥ 0.4 on phrase or any soundsLike) are kept,
 * preserving input order.
 */
export function filterDictionary(
  entries: readonly DictionaryEntry[],
  transcript: string,
): DictionaryEntry[] {
  const withinCap =
    entries.length <= DICT_MAX_ENTRIES && estimateDictionaryTokens(entries) <= DICT_MAX_TOKENS;
  if (withinCap) return [...entries];
  return entries.filter((entry) => entryMatchesTranscript(entry, transcript));
}
