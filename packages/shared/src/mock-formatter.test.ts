import { describe, it, expect } from 'vitest';
import type { AppContext, FormatRequest } from './types';
import {
  MockFormatter,
  chunkText,
  countWords,
  isAlreadyClean,
  mockFormat,
  normalizeCanon,
} from './mock-formatter';

const appContext: AppContext = {
  bundleId: 'com.tinyspeck.slackmacgap',
  appName: 'Slack',
  windowTitle: '',
  register: 'chat',
};

function req(transcript: string): FormatRequest {
  return { transcript, appContext, dictionary: [], locale: 'en-US' };
}

/** Drain an async generator, returning the yielded chunks and the FormatResult return value. */
async function drain(
  gen: AsyncGenerator<string, { text: string; wordCount: number; commandsApplied: string[] }>,
): Promise<{
  chunks: string[];
  result: { text: string; wordCount: number; commandsApplied: string[] };
}> {
  const chunks: string[] = [];
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

describe('normalizeCanon', () => {
  it('unifies curly quotes, collapses whitespace, and trims', () => {
    expect(normalizeCanon('  she said  “hi”  ')).toBe('she said "hi"');
    expect(normalizeCanon('it’s ‘fine’')).toBe("it's 'fine'");
    expect(normalizeCanon('a\n\tb   c')).toBe('a b c');
  });
});

describe('countWords', () => {
  it('is a whitespace split; blank is zero', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  spaced \n out ')).toBe(2);
    expect(countWords('   ')).toBe(0);
  });
});

describe('mockFormat — §4.3 command grammar', () => {
  it('"new line" → single newline', () => {
    const { text, commandsApplied } = mockFormat('hello world new line goodbye');
    expect(text).toBe('Hello world.\nGoodbye.');
    expect(commandsApplied).toEqual(['new line']);
  });

  it('"new paragraph" → blank line', () => {
    const { text, commandsApplied } = mockFormat('para one new paragraph para two');
    expect(text).toBe('Para one.\n\nPara two.');
    expect(commandsApplied).toEqual(['new paragraph']);
  });

  it('"period" / "comma" attach to the preceding word', () => {
    expect(mockFormat('the meeting is at noon period').text).toBe('The meeting is at noon.');
    expect(mockFormat('first item comma second item').text).toBe('First item, second item.');
  });

  it('"question mark" / "exclamation point" attach to the preceding word', () => {
    expect(mockFormat('are you coming question mark').text).toBe('Are you coming?');
    expect(mockFormat('watch out exclamation point').text).toBe('Watch out!');
  });

  it('"all caps X end caps" uppercases the span', () => {
    const { text, commandsApplied } = mockFormat('the value is all caps json end caps got it');
    expect(text).toBe('The value is JSON got it.');
    expect(commandsApplied).toEqual(['all caps']);
  });

  it('"quote X end quote" wraps in straight double quotes', () => {
    const { text, commandsApplied } = mockFormat('she said quote hello there end quote loudly');
    expect(text).toBe('She said "hello there" loudly.');
    expect(commandsApplied).toEqual(['quote']);
  });

  it('"bullet list … end list" builds a markdown list delimited by "new line"', () => {
    const { text, commandsApplied } = mockFormat(
      'bullet list apples new line bananas new line cherries end list',
    );
    expect(text).toBe('- Apples\n- Bananas\n- Cherries');
    expect(commandsApplied).toEqual(['bullet list']);
  });

  it('"numbered list … end list" builds an ordered markdown list', () => {
    const { text, commandsApplied } = mockFormat('numbered list first new line second end list');
    expect(text).toBe('1. First\n2. Second');
    expect(commandsApplied).toEqual(['numbered list']);
  });

  it('"scratch that" deletes the previous (terminated) sentence', () => {
    const { text, commandsApplied } = mockFormat(
      'i love cats period scratch that i love dogs period',
    );
    expect(text).toBe('I love dogs.');
    expect(commandsApplied).toEqual(['period', 'scratch that', 'period']);
  });

  it('"scratch that" deletes an in-progress sentence back to the prior boundary', () => {
    expect(mockFormat('one period two three scratch that four').text).toBe('One. Four.');
  });
});

describe('mockFormat — cleanup rules', () => {
  it('strips the exact disfluency list (word-boundary, case-insensitive) and does not record them', () => {
    const { text, commandsApplied } = mockFormat('um so uh the plan Er is ready');
    expect(text).toBe('So the plan is ready.');
    expect(commandsApplied).toEqual([]);
  });

  it('does not strip disfluency substrings inside real words', () => {
    // "here" contains "er", "number" contains "um" — neither is a standalone disfluency.
    expect(mockFormat('the number here period').text).toBe('The number here.');
  });

  it('capitalizes sentence starts and adds a terminal period to prose', () => {
    expect(mockFormat('hello world').text).toBe('Hello world.');
  });

  it('records each command occurrence for telemetry counts', () => {
    const { commandsApplied } = mockFormat('a period b period c period');
    expect(commandsApplied).toEqual(['period', 'period', 'period']);
  });
});

describe('mockFormat — do-no-harm passthrough', () => {
  it('returns already-clean text byte-identical', () => {
    const clean = 'The meeting is at noon. See you there.';
    expect(isAlreadyClean(clean)).toBe(true);
    const { text, commandsApplied } = mockFormat(clean);
    expect(text).toBe(clean);
    expect(commandsApplied).toEqual([]);
  });

  it('leaves clean text containing command words untouched (does not re-interpret them)', () => {
    const clean = 'New line spacing was adjusted. It works now.';
    expect(isAlreadyClean(clean)).toBe(true);
    expect(mockFormat(clean).text).toBe(clean);
  });

  it('does NOT passthrough when a sentence start is lowercase', () => {
    expect(isAlreadyClean('the meeting is at noon.')).toBe(false);
    expect(mockFormat('the meeting is at noon.').text).toBe('The meeting is at noon.');
  });

  it('does NOT passthrough when not already normalized (curly quotes / double spaces)', () => {
    expect(isAlreadyClean('He said  “hi”.')).toBe(false);
    expect(mockFormat('He said  “hi”.').text).toBe('He said "hi".');
  });
});

describe('chunkText', () => {
  it('splits into at most 3 chunks whose concatenation is the input', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const chunks = chunkText(text);
    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join('')).toBe(text);
  });
});

describe('MockFormatter — streaming', () => {
  it('yields 2–3 chunks that reassemble to the FormatResult text', async () => {
    const controller = new AbortController();
    const { chunks, result } = await drain(
      new MockFormatter().format(req('hello world new line goodbye'), controller.signal),
    );
    expect(chunks.join('')).toBe(result.text);
    expect(result.text).toBe('Hello world.\nGoodbye.');
    expect(result.wordCount).toBe(countWords(result.text));
    expect(result.commandsApplied).toEqual(['new line']);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it('throws when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const gen = new MockFormatter().format(req('hello world'), controller.signal);
    await expect(gen.next()).rejects.toThrow();
  });
});
