// Haiku system-prompt builder — CONTRACTS.md §4.3 / §6. Pure and fully tested: given the
// active register and an ALREADY-FILTERED dictionary, it renders the frozen system prompt the
// HaikuFormatter sends. Never contains transcript content (that rides in the user turn).
import type { DictionaryEntry, Register } from '@undertone/shared';

/** The §4.3 spoken-command grammar, verbatim, with imperative-vs-dictated-prose guidance. */
export const GRAMMAR_SECTION = `SPOKEN COMMAND GRAMMAR (guide §4.3) — apply EXACTLY these, nothing more:
- "new line" → a single newline
- "new paragraph" → a blank line (two newlines)
- "period" / "comma" / "question mark" / "exclamation point" → attach that punctuation to the preceding word
- "scratch that" → delete the previous sentence
- "all caps X end caps" → render X in uppercase
- "bullet list" … "end list" / "numbered list" … "end list" → a markdown list; items are delimited by a spoken "new line"
- "quote X end quote" → wrap X in straight double quotes

Disambiguation: treat these as commands only when the speaker is issuing them, not when the
same words are part of the dictated content. "the Jurassic period" is prose; "add a comma
period" ends a sentence. When a word plausibly belongs to the sentence's meaning, keep it as
prose; when it is a standalone instruction at a clause boundary, apply the command.`;

/** One-line tone guidance per Register value (CONTRACTS §1 / §6 register conditioning). */
export const REGISTER_GUIDANCE: Record<Register, string> = {
  chat: 'chat — casual and concise; light punctuation; contractions are fine.',
  email: 'email — professional, complete sentences; preserve greetings and sign-offs.',
  code: 'code — preserve identifiers, symbols, and casing verbatim; do not prose-capitalize code.',
  document: 'document — formal prose with full punctuation and capitalization.',
  terminal: 'terminal — literal commands and tokens; no autocapitalization or added punctuation.',
  unknown: 'unknown — neutral default; clean lightly without imposing a register.',
};

/** Fixed do-no-harm instruction (CONTRACTS §6). */
export const DO_NO_HARM_SECTION =
  'DO NO HARM: if the transcript is already clean, well-formatted text (correct sentence-terminal ' +
  'punctuation and uppercase sentence starts), return it unchanged.';

/** Fixed output contract (CONTRACTS §6). */
export const OUTPUT_CONTRACT_SECTION =
  'OUTPUT: return only the formatted text. No preamble, no explanation, no surrounding quotes, ' +
  'no code fences.';

/** Render one dictionary line: `phrase (may be misheard as: a, b)` or bare `phrase`. */
export function renderDictionaryLine(entry: DictionaryEntry): string {
  const variants = entry.soundsLike.filter((v) => v.trim() !== '');
  if (variants.length === 0) return entry.phrase;
  return `${entry.phrase} (may be misheard as: ${variants.join(', ')})`;
}

function renderRegisterSection(active: Register): string {
  const registers: Register[] = ['chat', 'email', 'code', 'document', 'terminal', 'unknown'];
  const lines = registers.map((r) => `- ${REGISTER_GUIDANCE[r]}`).join('\n');
  return `REGISTER CONDITIONING — the target app's register determines tone:\n${lines}\nActive register: ${active}.`;
}

function renderDictionarySection(dictionary: readonly DictionaryEntry[]): string {
  if (dictionary.length === 0) {
    return 'DICTIONARY: none provided for this utterance.';
  }
  const lines = dictionary.map((e) => `- ${renderDictionaryLine(e)}`).join('\n');
  return `DICTIONARY — prefer these spellings; the parenthetical lists likely ASR mishearings:\n${lines}`;
}

/**
 * Build the frozen system prompt. `dictionary` MUST already be capped/filtered per §6 (the
 * service calls dict-filter before this). The prompt is deterministic given its inputs, so it
 * is safe to cache and straightforward to test.
 */
export function buildSystemPrompt(
  register: Register,
  dictionary: readonly DictionaryEntry[],
): string {
  return [
    'You are Undertone, a dictation formatter. You turn a raw speech-to-text transcript into ' +
      'polished text for the user to paste into the app they were focused on.',
    GRAMMAR_SECTION,
    renderRegisterSection(register),
    renderDictionarySection(dictionary),
    DO_NO_HARM_SECTION,
    OUTPUT_CONTRACT_SECTION,
  ].join('\n\n');
}
