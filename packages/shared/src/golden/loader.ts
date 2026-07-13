// Golden-set loader — reads and shape-validates every fixture in fixtures/golden/*.json.
// Validation happens at load (not via static import) so a malformed fixture throws loudly
// rather than sneaking a bad shape past `tsc`.
//
// FIXTURE LAYOUT: grouped — one JSON array per category file:
//   commands.json    the §4.3 command grammar (one dedicated case per command + combos)
//   do-no-harm.json  already-clean pass-through cases + the empty-input edge case
//   registers.json   register adaptation (chat / email / code / document / terminal)
//   false-starts.json  disfluent false-start repair
//   ambiguous.json   command-word-as-prose ("the period was difficult")
//   dictionary.json  proper-noun ASR-mishearing → phrase substitution
//
// MOCK-DERIVATION RULES (every `kind:"command"` case is mechanically reproducible from EXACTLY
// these — task 1e's MockFormatter must match; kept here so both sides share one spec):
//   1. strip disfluencies: whole words "um" | "uh" | "er" | "erm" (case-insensitive)
//   2. "scratch that" deletes the sentence immediately preceding it
//   3. list: split the utterance on the spoken delimiter "new line" → markdown bullets
//      ("- " + item, first letter of each item capitalized, no terminal period)
//   4. "all caps X end caps" → uppercase(X), markers removed
//   5. "quote X end quote" → "X" (straight double quotes)
//   6. punctuation words attach to the preceding word, no leading space:
//        period → .   comma → ,   question mark → ?   exclamation mark → !
//        colon → :    semicolon → ;
//   7. sentence-start capitalization
//   8. terminal period appended to a prose sentence that lacks terminal punctuation
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppContext, DictionaryEntry, Register } from '../types';
import type { GoldenCase, GoldenKind } from './types';

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/golden/', import.meta.url));

const REGISTERS: readonly Register[] = ['chat', 'email', 'code', 'document', 'terminal', 'unknown'];
const KINDS: readonly GoldenKind[] = ['command', 'prose'];

function fail(where: string, message: string): never {
  throw new Error(`golden fixture ${where}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, `expected string, got ${typeof value}`);
  return value;
}

function asBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') fail(where, `expected boolean, got ${typeof value}`);
  return value;
}

function validateAppContext(value: unknown, where: string): AppContext {
  if (!isRecord(value)) fail(where, 'appContext must be an object');
  const register = asString(value.register, `${where}.register`);
  if (!REGISTERS.includes(register as Register)) {
    fail(`${where}.register`, `unknown register "${register}"`);
  }
  return {
    bundleId: asString(value.bundleId, `${where}.bundleId`),
    appName: asString(value.appName, `${where}.appName`),
    windowTitle: asString(value.windowTitle, `${where}.windowTitle`),
    register: register as Register,
  };
}

function validateDictionaryEntry(value: unknown, where: string): DictionaryEntry {
  if (!isRecord(value)) fail(where, 'dictionary entry must be an object');
  const soundsLike = value.soundsLike;
  if (!Array.isArray(soundsLike)) fail(`${where}.soundsLike`, 'expected array');
  return {
    id: asString(value.id, `${where}.id`),
    phrase: asString(value.phrase, `${where}.phrase`),
    soundsLike: soundsLike.map((s, i) => asString(s, `${where}.soundsLike[${i}]`)),
    createdAt: asString(value.createdAt, `${where}.createdAt`),
  };
}

function validateCase(value: unknown, where: string): GoldenCase {
  if (!isRecord(value)) fail(where, 'case must be an object');
  const kind = asString(value.kind, `${where}.kind`);
  if (!KINDS.includes(kind as GoldenKind)) fail(`${where}.kind`, `unknown kind "${kind}"`);
  const dictionary = value.dictionary;
  if (!Array.isArray(dictionary)) fail(`${where}.dictionary`, 'expected array');
  return {
    id: asString(value.id, `${where}.id`),
    kind: kind as GoldenKind,
    haikuOnly: asBoolean(value.haikuOnly, `${where}.haikuOnly`),
    input: asString(value.input, `${where}.input`),
    appContext: validateAppContext(value.appContext, `${where}.appContext`),
    dictionary: dictionary.map((e, i) => validateDictionaryEntry(e, `${where}.dictionary[${i}]`)),
    expected: asString(value.expected, `${where}.expected`),
  };
}

/** Load, shape-validate, and dedup the whole golden set. Throws on any malformed fixture. */
export function loadGoldenSet(): GoldenCase[] {
  const files = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const cases: GoldenCase[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
    } catch (err) {
      fail(file, `invalid JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(parsed)) fail(file, 'expected a top-level JSON array of cases');

    parsed.forEach((entry, index) => {
      const golden = validateCase(entry, `${file}[${index}]`);
      if (seen.has(golden.id)) fail(`${file}[${index}]`, `duplicate id "${golden.id}"`);
      seen.add(golden.id);
      cases.push(golden);
    });
  }

  if (cases.length === 0) fail('fixtures/golden', 'no cases found');
  return cases;
}
