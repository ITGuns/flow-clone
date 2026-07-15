// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { ResultCard } from './ResultCard';
import { buttonByText, click, mount, text, type Mounted } from '../test/harness';
import type { Utterance } from '../dictation/session-state';

function makeUtterance(over: Partial<Utterance> = {}): Utterance {
  return {
    id: 1,
    style: 'document',
    phase: 'done',
    partial: '',
    transcript: '',
    text: '',
    wordCount: 0,
    unformatted: false,
    quotaExceeded: false,
    errorMessage: null,
    ...over,
  };
}

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe('ResultCard', () => {
  it('prompts when there is no utterance yet', async () => {
    mounted = await mount(<ResultCard utterance={null} />);
    expect(text(mounted.container)).toContain('Hold to talk');
  });

  it('shows the live partial while recording', async () => {
    mounted = await mount(
      <ResultCard utterance={makeUtterance({ phase: 'recording', partial: 'hello wor' })} />,
    );
    expect(text(mounted.container)).toContain('hello wor');
  });

  it('shows the formatted text, word count, and a working Copy button on done', async () => {
    const copies: string[] = [];
    mounted = await mount(
      <ResultCard
        utterance={makeUtterance({ text: 'Hello world.', wordCount: 2, phase: 'done' })}
        copy={(t) => {
          copies.push(t);
          return Promise.resolve(true);
        }}
      />,
    );
    expect(text(mounted.container)).toContain('Hello world.');
    expect(text(mounted.container)).toContain('2 words');
    await click(buttonByText(mounted.container, 'Copy'));
    expect(copies).toEqual(['Hello world.']);
    expect(buttonByText(mounted.container, 'Copied')).toBeTruthy();
  });

  it('surfaces the §8 raw-fallback as an "unformatted" note', async () => {
    mounted = await mount(
      <ResultCard
        utterance={makeUtterance({ text: 'raw words', wordCount: 2, unformatted: true })}
      />,
    );
    expect(text(mounted.container).toLowerCase()).toContain('unformatted');
  });

  it('surfaces §8 QUOTA_EXCEEDED as a non-blocking upgrade note, keeping the text', async () => {
    mounted = await mount(
      <ResultCard
        utterance={makeUtterance({ text: 'Kept.', wordCount: 1, quotaExceeded: true })}
      />,
    );
    const body = text(mounted.container);
    expect(body).toContain('Kept.');
    expect(body.toLowerCase()).toContain('weekly limit reached');
  });

  it('renders an error state', async () => {
    mounted = await mount(
      <ResultCard utterance={makeUtterance({ phase: 'error', errorMessage: 'ASR unavailable' })} />,
    );
    expect(text(mounted.container)).toContain('ASR unavailable');
  });
});
