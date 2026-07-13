import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Formatter } from '../formatter';
import type { FormatRequest, FormatResult } from '../types';
import { loadGoldenSet } from './loader';
import { commandMatches, lexicalF1, normalize } from './scorer';
import { runGoldenSet } from './runner';
import type { GoldenCase } from './types';

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/golden/', import.meta.url));

// Trivial pass-through formatter: emits the transcript unchanged. It MUST pass do-no-harm
// cases and MUST fail every command case that actually transforms its input — that gap is
// what proves the scorer discriminates rather than rubber-stamping.
const identityFormatter: Formatter = {
  async *format(req: FormatRequest, _signal: AbortSignal): AsyncGenerator<string, FormatResult> {
    yield req.transcript;
    return {
      text: req.transcript,
      wordCount: req.transcript.split(/\s+/).filter(Boolean).length,
      commandsApplied: [],
    };
  },
};

// A formatter that always throws — the runner must record it as a failed case, never rethrow.
const throwingFormatter: Formatter = {
  // eslint-disable-next-line require-yield
  async *format(): AsyncGenerator<string, FormatResult> {
    throw new Error('boom');
  },
};

const SET = loadGoldenSet();
const commandCases = SET.filter((c) => c.kind === 'command');
const proseCases = SET.filter((c) => c.kind === 'prose');
const isDoNoHarm = (c: GoldenCase) => normalize(c.input) === normalize(c.expected);

describe('loadGoldenSet — shape & coverage', () => {
  it('loads at least 40 well-formed cases with unique ids', () => {
    expect(SET.length).toBeGreaterThanOrEqual(40);
    expect(new Set(SET.map((c) => c.id)).size).toBe(SET.length);
  });

  it('every case satisfies the GoldenCase shape', () => {
    for (const c of SET) {
      expect(typeof c.id).toBe('string');
      expect(['command', 'prose']).toContain(c.kind);
      expect(typeof c.haikuOnly).toBe('boolean');
      expect(typeof c.input).toBe('string');
      expect(typeof c.expected).toBe('string');
      expect(['chat', 'email', 'code', 'document', 'terminal', 'unknown']).toContain(
        c.appContext.register,
      );
      expect(Array.isArray(c.dictionary)).toBe(true);
    }
  });

  it('covers every §4.3 command with a dedicated case', () => {
    const ids = new Set(SET.map((c) => c.id));
    for (const id of [
      'cmd-disfluency-simple',
      'cmd-punct-period-comma',
      'cmd-scratch-that',
      'cmd-allcaps-json',
      'cmd-list-grocery',
      'cmd-quote-basic',
      'cmd-sentence-cap-multi',
      'cmd-terminal-period-simple',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('every command case is mock-passable (not marked haikuOnly)', () => {
    for (const c of commandCases) expect(c.haikuOnly).toBe(false);
  });

  it('spans at least three registers', () => {
    expect(new Set(SET.map((c) => c.appContext.register)).size).toBeGreaterThanOrEqual(3);
  });

  it('has at least two do-no-harm cases (expected === input)', () => {
    expect(SET.filter(isDoNoHarm).length).toBeGreaterThanOrEqual(2);
  });

  it('has exactly one empty-input case with empty expected', () => {
    const empties = SET.filter((c) => c.input === '');
    expect(empties.length).toBe(1);
    expect(empties[0]?.expected).toBe('');
  });

  it('includes the ambiguous command-as-prose case ("the period was difficult")', () => {
    const amb = SET.find((c) => c.id === 'amb-period-as-word');
    expect(amb?.kind).toBe('prose');
    expect(amb?.haikuOnly).toBe(true);
    expect(amb?.expected.toLowerCase()).toContain('period');
  });

  it('dictionary cases embed the mishearing in the input and the phrase entry inline', () => {
    const dictCases = SET.filter((c) => c.dictionary.length > 0);
    expect(dictCases.length).toBeGreaterThanOrEqual(3);
    for (const c of dictCases) {
      const input = c.input.toLowerCase();
      const heard = c.dictionary.some((e) =>
        e.soundsLike.some((s) => input.includes(s.toLowerCase())),
      );
      expect(heard).toBe(true);
    }
  });
});

describe('loadGoldenSet — validation throws on malformed', () => {
  const stray = join(FIXTURES_DIR, 'zz-malformed.tmp.json');
  const cleanup = () => {
    for (const f of readdirSync(FIXTURES_DIR)) {
      if (f.endsWith('.tmp.json')) rmSync(join(FIXTURES_DIR, f));
    }
  };
  beforeAll(cleanup);
  afterEach(cleanup);

  it('throws when a fixture case is missing a required field', () => {
    writeFileSync(stray, JSON.stringify([{ id: 'bad', kind: 'command' }]), 'utf8');
    expect(() => loadGoldenSet()).toThrow(/haikuOnly|expected/);
  });

  it('throws when a fixture kind is unknown', () => {
    writeFileSync(
      stray,
      JSON.stringify([
        {
          id: 'bad2',
          kind: 'shout',
          haikuOnly: false,
          input: 'x',
          appContext: { bundleId: 'b', appName: 'a', windowTitle: '', register: 'chat' },
          dictionary: [],
          expected: 'X',
        },
      ]),
      'utf8',
    );
    expect(() => loadGoldenSet()).toThrow(/unknown kind/);
  });

  it('throws when a file is not a JSON array', () => {
    writeFileSync(stray, JSON.stringify({ not: 'an array' }), 'utf8');
    expect(() => loadGoldenSet()).toThrow(/array/);
  });
});

describe('scorer', () => {
  it('normalize collapses whitespace and unifies curly quotes', () => {
    expect(normalize('  hello   world  ')).toBe('hello world');
    expect(normalize('“quote” and ‘apos’')).toBe('"quote" and \'apos\'');
  });

  it('commandMatches is whitespace- and quote-insensitive but otherwise exact', () => {
    expect(commandMatches('He said "no".', 'He said “no”.')).toBe(true);
    expect(commandMatches('Hello,  world.', 'Hello, world.')).toBe(true);
    expect(commandMatches('Hello world.', 'hello world.')).toBe(false);
  });

  it('lexicalF1 is 1 for identical, 0 for disjoint, 1 for both-empty', () => {
    expect(lexicalF1('ship it today', 'ship it today')).toBe(1);
    expect(lexicalF1('alpha beta', 'gamma delta')).toBe(0);
    expect(lexicalF1('', '')).toBe(1);
    expect(lexicalF1('anything', '')).toBe(0);
  });

  it('lexicalF1 crosses 0.85 only for near-identical prose', () => {
    const expected = 'The meeting is on Wednesday afternoon this week';
    expect(
      lexicalF1(expected, 'The meeting is on Wednesday afternoon this week!'),
    ).toBeGreaterThanOrEqual(0.85);
    expect(lexicalF1(expected, 'We should cancel the meeting entirely')).toBeLessThan(0.85);
  });
});

describe('runGoldenSet — discriminates with an identity formatter', () => {
  it('passes do-no-harm cases and fails every transforming command case', async () => {
    const report = await runGoldenSet(identityFormatter, {
      includeHaikuOnly: false,
      cases: commandCases,
    });

    expect(report.byKind.prose.total).toBe(0);
    expect(report.byKind.command.total).toBe(commandCases.length);

    for (const result of report.results) {
      const original = commandCases.find((c) => c.id === result.id);
      if (original && isDoNoHarm(original)) {
        expect(result.pass, `do-no-harm ${result.id} should pass identity`).toBe(true);
      } else {
        expect(result.pass, `transforming ${result.id} should fail identity`).toBe(false);
      }
    }

    // The set must actually contain transforming command cases, or the test proves nothing.
    expect(commandCases.some((c) => !isDoNoHarm(c))).toBe(true);
    expect(report.passed).toBeLessThan(report.total);
    expect(report.passed).toBeGreaterThan(0);
  });

  it('excludes haikuOnly cases by default and includes them on request', async () => {
    const dflt = await runGoldenSet(identityFormatter);
    const full = await runGoldenSet(identityFormatter, { includeHaikuOnly: true });
    expect(dflt.total).toBe(SET.filter((c) => !c.haikuOnly).length);
    expect(full.total).toBe(SET.length);
    expect(full.total).toBeGreaterThan(dflt.total);
  });

  it('records a throwing formatter as failed cases without rethrowing', async () => {
    const report = await runGoldenSet(throwingFormatter, {
      includeHaikuOnly: true,
      cases: SET.slice(0, 3),
    });
    expect(report.passed).toBe(0);
    expect(report.results.every((r) => r.error === 'boom' && !r.pass && r.actual === '')).toBe(
      true,
    );
  });

  it('aggregate counts are internally consistent', async () => {
    const report = await runGoldenSet(identityFormatter, { includeHaikuOnly: true });
    expect(report.passed + report.failed).toBe(report.total);
    expect(report.byKind.command.total + report.byKind.prose.total).toBe(report.total);
    expect(report.passRate).toBeCloseTo(report.passed / report.total, 10);
  });
});

describe('golden set sanity', () => {
  it('has both command and prose cases', () => {
    expect(commandCases.length).toBeGreaterThan(0);
    expect(proseCases.length).toBeGreaterThan(0);
  });
});
