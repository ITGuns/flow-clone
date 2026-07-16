// MockFormatter — CONTRACTS.md §2.2 / §4.3 / §6. Deterministic, keyless formatter for
// MOCK_MODE and the golden set. Applies EXACTLY the §4.3 spoken-command grammar plus the
// documented cleanup rules — nothing more — and streams its result in 2–3 chunks so streaming
// consumers are exercised. The normalization canon here is shared with task 1f's golden set;
// do not diverge from it.
import type { Formatter } from './formatter';
import type { FormatRequest, FormatResult } from './types';

/**
 * Canonical §4.3 command names, as recorded in FormatResult.commandsApplied (one entry per
 * occurrence, in order — the field is "for telemetry counts only", so duplicates are kept).
 */
export type MockCommand =
  | 'new line'
  | 'new paragraph'
  | 'period'
  | 'comma'
  | 'question mark'
  | 'exclamation point'
  | 'scratch that'
  | 'all caps'
  | 'bullet list'
  | 'numbered list'
  | 'quote';

/** Disfluencies stripped verbatim (word-boundary, case-insensitive) — CONTRACTS §4.3 rules. */
const DISFLUENCIES = ['um', 'uh', 'er', 'erm'] as const;
const DISFLUENCY_RE = new RegExp(String.raw`\b(?:${DISFLUENCIES.join('|')})\b`, 'gi');

export interface MockFormatOutcome {
  text: string;
  commandsApplied: MockCommand[];
}

// --- Normalization canon (shared with the 1f golden set) --------------------------------
// trim · collapse whitespace runs to a single space · unify curly quotes to straight.
// MockFormatter output is always already-normalized.
const CURLY_QUOTE_MAP: Record<string, string> = {
  '‘': "'", // ‘
  '’': "'", // ’
  '“': '"', // “
  '”': '"', // ”
};

/** Apply the normalization canon: straight quotes, single spaces, trimmed. */
export function normalizeCanon(input: string): string {
  const straightened = input.replace(/[‘’“”]/g, (q) => CURLY_QUOTE_MAP[q] ?? q);
  return straightened.replace(/\s+/g, ' ').trim();
}

/** Whitespace-split word count — the §1 metering unit. Empty/blank text is 0. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

// --- Do-no-harm heuristic ---------------------------------------------------------------
// Already-clean formatted text passes through UNCHANGED. "Clean" is defined, per CONTRACTS,
// as text that (a) already matches the normalization canon (so "unchanged" cannot violate
// it), (b) has sentence-terminal punctuation, and (c) starts every sentence with an
// uppercase letter. The gate deliberately does NOT test for command keywords: clean prose
// that happens to contain words like "period" or "new line" (e.g. "New line of code.")
// must be left alone rather than re-interpreted as commands.
function endsWithTerminal(text: string): boolean {
  return /[.!?]["')\]]?\s*$/.test(text);
}

/** Every sentence (start of text, and after a terminal + space) begins with an uppercase letter. */
function hasUppercaseSentenceStarts(text: string): boolean {
  // Collect the first alphabetic character of each sentence.
  const sentenceStarts = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentenceStarts) {
    const match = sentence.match(/[A-Za-z]/);
    const letter = match?.[0];
    if (letter !== undefined && letter !== letter.toUpperCase()) return false;
  }
  return true;
}

/** True when the input is already clean formatted text and must pass through untouched. */
export function isAlreadyClean(input: string): boolean {
  if (input.trim() === '') return false;
  if (input !== normalizeCanon(input)) return false; // must already be normalized
  if (!endsWithTerminal(input)) return false;
  return hasUppercaseSentenceStarts(input);
}

// --- Command resolution -----------------------------------------------------------------
interface WordToken {
  type: 'word';
  text: string;
}
interface BreakToken {
  type: 'break';
  kind: 'line' | 'paragraph';
}
type Token = WordToken | BreakToken;

const PUNCTUATION: Record<string, string> = {
  period: '.',
  comma: ',',
};

/** Append punctuation to the most recent word token, if any (attach-to-preceding-word rule). */
function attachPunctuation(tokens: Token[], char: string): void {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (token.type === 'word') {
      token.text += char;
      return;
    }
    return; // break token: sentence ended at the break; nothing to attach to
  }
}

/**
 * "scratch that" deletes the previous sentence: pop trailing word tokens back to the most
 * recent sentence boundary — a word ending in terminal punctuation, or a break token, or the
 * start of the stream. Trailing break tokens (a scratch immediately after a line break) are
 * removed first so the just-broken empty sentence is discarded.
 */
function applyScratch(tokens: Token[]): void {
  while (tokens.length > 0 && tokens[tokens.length - 1]?.type === 'break') tokens.pop();
  if (tokens.length === 0) return;
  // The last sentence ends at the final token; its own terminal punctuation belongs to it, so
  // start the boundary search one token back and stop at the PRIOR sentence end (terminal word
  // or break) — everything after that boundary is the sentence being scratched.
  let i = tokens.length - 2;
  while (i >= 0) {
    const token = tokens[i];
    if (token === undefined || token.type === 'break') break;
    if (endsWithTerminal(token.text)) break;
    i -= 1;
  }
  tokens.length = Math.max(0, i + 1);
}

/** Lowercased two-word phrase starting at index i, or ''. */
function twoWords(words: string[], i: number): string {
  const a = words[i];
  const b = words[i + 1];
  if (a === undefined || b === undefined) return '';
  return `${a.toLowerCase()} ${b.toLowerCase()}`;
}

/**
 * Resolve the §4.3 command grammar over the normalized, disfluency-stripped word list into a
 * token stream, recording each command fired. Multi-word forms (all caps … end caps,
 * quote … end quote, bullet/numbered list … end list) consume their span here.
 */
function resolveCommands(words: string[]): { tokens: Token[]; commands: MockCommand[] } {
  const tokens: Token[] = [];
  const commands: MockCommand[] = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    if (word === undefined) break;
    const lower = word.toLowerCase();
    const pair = twoWords(words, i);

    if (pair === 'new paragraph') {
      tokens.push({ type: 'break', kind: 'paragraph' });
      commands.push('new paragraph');
      i += 2;
      continue;
    }
    if (pair === 'new line') {
      tokens.push({ type: 'break', kind: 'line' });
      commands.push('new line');
      i += 2;
      continue;
    }
    if (pair === 'scratch that') {
      applyScratch(tokens);
      commands.push('scratch that');
      i += 2;
      continue;
    }
    if (pair === 'question mark') {
      attachPunctuation(tokens, '?');
      commands.push('question mark');
      i += 2;
      continue;
    }
    if (pair === 'exclamation point') {
      attachPunctuation(tokens, '!');
      commands.push('exclamation point');
      i += 2;
      continue;
    }
    if (pair === 'all caps') {
      i += 2;
      const captured: string[] = [];
      while (i < words.length && twoWords(words, i) !== 'end caps') {
        const w = words[i];
        if (w !== undefined) captured.push(w.toUpperCase());
        i += 1;
      }
      if (i < words.length) i += 2; // consume "end caps"
      for (const upper of captured) tokens.push({ type: 'word', text: upper });
      commands.push('all caps');
      continue;
    }
    if (pair === 'bullet list' || pair === 'numbered list') {
      const ordered = pair === 'numbered list';
      i += 2;
      // Collect list words until "end list"; items are delimited by spoken "new line".
      const items: string[][] = [];
      let current: string[] = [];
      items.push(current);
      while (i < words.length && twoWords(words, i) !== 'end list') {
        if (twoWords(words, i) === 'new line') {
          current = [];
          items.push(current);
          i += 2;
          continue;
        }
        const w = words[i];
        if (w !== undefined) current.push(w);
        i += 1;
      }
      if (i < words.length) i += 2; // consume "end list"
      const rendered = items
        .map((parts) => parts.join(' ').trim())
        .filter((item) => item.length > 0);
      rendered.forEach((item, index) => {
        if (tokens.length > 0) tokens.push({ type: 'break', kind: 'line' });
        const marker = ordered ? `${index + 1}. ` : '- ';
        tokens.push({ type: 'word', text: `${marker}${item}` });
      });
      commands.push(ordered ? 'numbered list' : 'bullet list');
      continue;
    }
    if (lower === 'quote') {
      i += 1;
      const captured: string[] = [];
      while (i < words.length && twoWords(words, i) !== 'end quote') {
        const w = words[i];
        if (w !== undefined) captured.push(w);
        i += 1;
      }
      if (i < words.length) i += 2; // consume "end quote"
      const n = captured.length;
      if (n === 1) {
        const only = captured[0];
        if (only !== undefined) captured[0] = `"${only}"`;
      } else if (n > 1) {
        const first = captured[0];
        const last = captured[n - 1];
        if (first !== undefined) captured[0] = `"${first}`;
        if (last !== undefined) captured[n - 1] = `${last}"`;
      }
      for (const part of captured) tokens.push({ type: 'word', text: part });
      commands.push('quote');
      continue;
    }
    if (lower === 'period' || lower === 'comma') {
      const char = PUNCTUATION[lower];
      if (char !== undefined) attachPunctuation(tokens, char);
      commands.push(lower);
      i += 1;
      continue;
    }

    tokens.push({ type: 'word', text: word });
    i += 1;
  }

  return { tokens, commands };
}

/** Assemble the token stream into a raw string: words joined by single spaces, breaks → newlines. */
function assemble(tokens: Token[]): string {
  let out = '';
  let needSpace = false;
  for (const token of tokens) {
    if (token.type === 'break') {
      out += token.kind === 'paragraph' ? '\n\n' : '\n';
      needSpace = false;
      continue;
    }
    if (needSpace) out += ' ';
    out += token.text;
    needSpace = true;
  }
  return out;
}

const LIST_ITEM_RE = /^(?:- |\d+\. )/;

/** Capitalize the first alphabetic character of every sentence within a single line of text. */
function capitalizeSentences(line: string): string {
  return line.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, letter: string) => {
    return `${lead}${letter.toUpperCase()}`;
  });
}

/**
 * Prose cleanup: per line, capitalize sentence starts; for prose lines (not markdown list
 * items) ensure the line ends with terminal punctuation, appending a period when absent.
 * List items are capitalized after their marker but never get a forced terminal period.
 */
function proseCleanup(assembled: string): string {
  const lines = assembled.split('\n');
  return lines
    .map((line) => {
      if (line.trim() === '') return line;
      if (LIST_ITEM_RE.test(line)) {
        // Capitalize the first letter after the marker; leave the rest of the item as-is.
        return line.replace(/^((?:- |\d+\. ))([a-z])/, (_m, marker: string, letter: string) => {
          return `${marker}${letter.toUpperCase()}`;
        });
      }
      let cleaned = capitalizeSentences(line);
      if (!endsWithTerminal(cleaned)) cleaned += '.';
      return cleaned;
    })
    .join('\n');
}

/**
 * Deterministic §4.3 formatting. Pure and side-effect free — the streaming class wraps this.
 * Already-clean input (per the do-no-harm heuristic) is returned byte-identical.
 */
export function mockFormat(transcript: string): MockFormatOutcome {
  if (isAlreadyClean(transcript)) {
    return { text: transcript, commandsApplied: [] };
  }

  const normalized = normalizeCanon(transcript);
  const stripped = normalizeCanon(normalized.replace(DISFLUENCY_RE, ' '));
  if (stripped === '') return { text: '', commandsApplied: [] };

  const words = stripped.split(' ');
  const { tokens, commands } = resolveCommands(words);
  const assembled = assemble(tokens);
  const text = proseCleanup(assembled);
  return { text, commandsApplied: commands };
}

// --- Streaming wrapper ------------------------------------------------------------------
/** Split text into 2–3 chunks whose concatenation is exactly `text` (exercises consumers). */
export function chunkText(text: string): string[] {
  if (text.length <= 1) return [text];
  const third = Math.ceil(text.length / 3);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += third) {
    chunks.push(text.slice(i, i + third));
  }
  return chunks;
}

function abortError(): Error {
  const err = new Error('MockFormatter aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * MockFormatter — the deterministic Formatter used under MOCK_MODE and by the golden set.
 * Streams the formatted result in 2–3 chunks; honors an already-aborted signal.
 */
export class MockFormatter implements Formatter {
  async *format(req: FormatRequest, signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    if (signal.aborted) throw abortError();
    const { text, commandsApplied } = mockFormat(req.transcript);
    for (const chunk of chunkText(text)) {
      if (signal.aborted) throw abortError();
      if (chunk.length > 0) yield chunk;
    }
    return { text, wordCount: countWords(text), commandsApplied };
  }
}
