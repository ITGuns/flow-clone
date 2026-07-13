// Golden-set runner — drives any Formatter through the set and scores it. Formatter-agnostic:
// HaikuFormatter, MockFormatter, or a trivial identity formatter all run here identically.
// A formatter that throws or hangs-then-throws never crashes the run — it is recorded as a
// failed case so a broken formatter scores 0, not "no data".
import type { Formatter } from '../formatter';
import { commandMatches, lexicalProseScorer, type ProseScorer } from './scorer';
import type { GoldenCase, GoldenKind } from './types';
import { loadGoldenSet } from './loader';

export interface GoldenCaseResult {
  id: string;
  kind: GoldenKind;
  haikuOnly: boolean;
  pass: boolean;
  /** command: 1 on match else 0. prose: the scorer's similarity in [0, 1]. */
  score: number;
  /** command: 1 (exact). prose: the scorer's threshold. */
  threshold: number;
  expected: string;
  /** Assembled formatter output, or "" if the formatter errored. */
  actual: string;
  /** Present iff the formatter threw for this case. */
  error?: string;
}

export interface GoldenReport {
  total: number;
  passed: number;
  failed: number;
  /** passed / total, or 1 when the run is empty. */
  passRate: number;
  byKind: Record<GoldenKind, { total: number; passed: number }>;
  results: GoldenCaseResult[];
}

export interface RunGoldenSetOptions {
  /** Include `haikuOnly` cases (register/repair/ambiguous/dictionary). Default false. */
  includeHaikuOnly?: boolean;
  /** Prose similarity scorer. Default: keyless lexical F1 (threshold 0.85). */
  proseScorer?: ProseScorer;
  /** Override the cases run (mainly for tests). Default: the loaded golden set. */
  cases?: GoldenCase[];
}

/** Fully drain the format() generator; the assembled text is the FormatResult's `text`. */
async function runFormatter(
  formatter: Formatter,
  golden: GoldenCase,
): Promise<{ actual: string; error?: string }> {
  try {
    const controller = new AbortController();
    const generator = formatter.format(
      {
        transcript: golden.input,
        appContext: golden.appContext,
        dictionary: golden.dictionary,
        locale: 'en-US',
      },
      controller.signal,
    );

    // Drain every delta; the assembled result is the FormatResult's `text` (§2.2).
    for (;;) {
      const step = await generator.next();
      if (step.done) return { actual: step.value.text };
    }
  } catch (err) {
    return { actual: '', error: err instanceof Error ? err.message : String(err) };
  }
}

async function scoreCase(
  golden: GoldenCase,
  actual: string,
  error: string | undefined,
  proseScorer: ProseScorer,
): Promise<GoldenCaseResult> {
  const base = {
    id: golden.id,
    kind: golden.kind,
    haikuOnly: golden.haikuOnly,
    expected: golden.expected,
    actual,
    ...(error !== undefined ? { error } : {}),
  };

  // A formatter error is a hard fail regardless of kind — never score against "".
  if (error !== undefined) {
    return {
      ...base,
      pass: false,
      score: 0,
      threshold: golden.kind === 'command' ? 1 : proseScorer.threshold,
    };
  }

  if (golden.kind === 'command') {
    const pass = commandMatches(golden.expected, actual);
    return { ...base, pass, score: pass ? 1 : 0, threshold: 1 };
  }

  const score = await proseScorer.score(golden.expected, actual);
  return { ...base, pass: score >= proseScorer.threshold, score, threshold: proseScorer.threshold };
}

/** Run a formatter against the golden set (or `opts.cases`) and return a scored report. */
export async function runGoldenSet(
  formatter: Formatter,
  opts?: RunGoldenSetOptions,
): Promise<GoldenReport> {
  const includeHaikuOnly = opts?.includeHaikuOnly ?? false;
  const proseScorer = opts?.proseScorer ?? lexicalProseScorer;
  const all = opts?.cases ?? loadGoldenSet();
  const cases = includeHaikuOnly ? all : all.filter((c) => !c.haikuOnly);

  const results: GoldenCaseResult[] = [];
  for (const golden of cases) {
    const { actual, error } = await runFormatter(formatter, golden);
    results.push(await scoreCase(golden, actual, error, proseScorer));
  }

  const byKind: Record<GoldenKind, { total: number; passed: number }> = {
    command: { total: 0, passed: 0 },
    prose: { total: 0, passed: 0 },
  };
  let passed = 0;
  for (const result of results) {
    byKind[result.kind].total += 1;
    if (result.pass) {
      byKind[result.kind].passed += 1;
      passed += 1;
    }
  }

  const total = results.length;
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 1 : passed / total,
    byKind,
    results,
  };
}
