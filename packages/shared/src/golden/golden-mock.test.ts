// MockFormatter conformance — CONTRACTS §6 / guide §4.3. The deterministic MockFormatter is the
// keyless formatting engine (MOCK_MODE, the golden set, the pipeline E2E), so it MUST score a
// perfect match on every non-haikuOnly golden case (the §4.3 command grammar + do-no-harm).
// haikuOnly cases (register adaptation, false-start repair, ambiguous command-vs-prose,
// dictionary substitution) are out of scope for a rule-based mock and are excluded — exactly the
// default `runGoldenSet` behaviour. This is the test that ties fixtures and mock together; a
// fixture that drifts from §4.3, or a mock that violates it, fails here.
import { describe, it, expect } from 'vitest';
import { MockFormatter } from '../mock-formatter';
import { loadGoldenSet } from './loader';
import { runGoldenSet } from './runner';

describe('golden set — MockFormatter conformance (§4.3, §6)', () => {
  it('passes 100% of non-haikuOnly cases', async () => {
    const report = await runGoldenSet(new MockFormatter(), { includeHaikuOnly: false });

    // Surface any drift with case ids + expected/actual so a failure diagnoses itself.
    const failures = report.results
      .filter((r) => !r.pass)
      .map((f) => ({ id: f.id, expected: f.expected, actual: f.actual, error: f.error }));
    expect(failures).toEqual([]);

    // Every non-haikuOnly case must actually have run (not vacuously green).
    const nonHaiku = loadGoldenSet().filter((c) => !c.haikuOnly).length;
    expect(report.total).toBe(nonHaiku);
    expect(report.passRate).toBe(1);
  });

  it('leaves haikuOnly cases to the real formatter (mock is not required to pass them)', async () => {
    // Sanity: the mock is NOT expected to satisfy register/repair/dictionary cases. This guards
    // against someone marking those non-haikuOnly (which would wrongly demand the mock pass them).
    const full = await runGoldenSet(new MockFormatter(), { includeHaikuOnly: true });
    const dflt = await runGoldenSet(new MockFormatter(), { includeHaikuOnly: false });
    expect(full.total).toBeGreaterThan(dflt.total);
  });
});
