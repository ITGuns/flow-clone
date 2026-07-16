// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import type { AppContext } from '@undertone/shared';
import { DictationSurface } from './DictationSurface';
import { makeFakeBrowserDeps, makeFakeDeps, type FakeRecognizer } from '../test/fakes';
import type { UsageState } from '../dictation/useDictation';
import type { FormatTranscriptResult } from '../api/client';
import {
  buttonByText,
  click,
  flush,
  keyDown,
  keyUp,
  mount,
  run,
  text,
  type Mounted,
} from '../test/harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

interface Setup {
  recognizer: FakeRecognizer;
  formatCalls: { transcript: string; appContext: AppContext }[];
  usageUpdates: UsageState[];
}

async function renderBrowser(result?: Partial<FormatTranscriptResult>): Promise<Setup> {
  const { browser, recognizer, formatCalls } = makeFakeBrowserDeps(result);
  const usageUpdates: UsageState[] = [];
  mounted = await mount(
    <DictationSurface
      deps={makeFakeDeps().deps}
      mode="browser"
      browser={browser}
      micEnabledByDefault
      onUsage={(u) => usageUpdates.push(u)}
    />,
  );
  return { recognizer, formatCalls, usageUpdates };
}

describe('DictationSurface — browser speech mode (D-026)', () => {
  it('holds → interim → release → POST /v1/format → renders the formatted result', async () => {
    const { recognizer, formatCalls } = await renderBrowser({
      text: 'Hello world.',
      wordCount: 2,
      commandsApplied: ['period'],
    });

    await keyDown(' ', 'Space');
    expect(text(mounted!.container)).toContain('Listening');
    expect(recognizer.started).toBe(1);

    await run(() => recognizer.emitInterim('hello wor'));
    expect(text(mounted!.container)).toContain('hello wor');

    await keyUp(' ', 'Space');
    await run(() => recognizer.resolveStop('hello world period'));
    await flush();

    expect(formatCalls).toHaveLength(1);
    expect(formatCalls[0]!.transcript).toBe('hello world period');
    const body = text(mounted!.container);
    expect(body).toContain('Hello world.');
    expect(body).toContain('2 words');
  });

  it('carries the selected style/register into the format call appContext (§1)', async () => {
    const { recognizer, formatCalls } = await renderBrowser();
    await click(buttonByText(mounted!.container, 'Email'));
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => recognizer.resolveStop('hi there'));
    await flush();
    expect(formatCalls[0]!.appContext.register).toBe('email');
    expect(formatCalls[0]!.appContext.bundleId).toBe('web.dashboard');
  });

  it('lifts the usage from the format response up to the meter', async () => {
    const { recognizer, usageUpdates } = await renderBrowser({
      usage: { wordsThisWeek: 512, limit: 2000 },
    });
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => recognizer.resolveStop('some words'));
    await flush();
    expect(usageUpdates.at(-1)).toEqual({ wordsThisWeek: 512, limit: 2000 });
  });

  it('keeps the result but flags QUOTA_EXCEEDED with an upgrade hint', async () => {
    const { recognizer } = await renderBrowser({
      text: 'Kept words.',
      wordCount: 2,
      exceeded: true,
    });
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => recognizer.resolveStop('kept words'));
    await flush();
    const body = text(mounted!.container).toLowerCase();
    expect(body).toContain('kept words.');
    expect(body).toContain('weekly limit reached');
  });

  it('shows the raw text with an "unformatted" note on the §8 fallback', async () => {
    const { recognizer } = await renderBrowser({
      text: 'raw words here',
      wordCount: 3,
      unformatted: true,
    });
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => recognizer.resolveStop('raw words here'));
    await flush();
    const body = text(mounted!.container).toLowerCase();
    expect(body).toContain('raw words here');
    expect(body).toContain('unformatted');
  });

  it('surfaces an honest error state on a recognizer error', async () => {
    const { recognizer } = await renderBrowser();
    await keyDown(' ', 'Space');
    await run(() => recognizer.emitError('network', 'down'));
    expect(text(mounted!.container).toLowerCase()).toContain('speech service is unreachable');
  });

  it('does not call the format endpoint when nothing was said', async () => {
    const { recognizer, formatCalls } = await renderBrowser();
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => recognizer.resolveStop('   '));
    await flush();
    expect(formatCalls).toHaveLength(0);
  });
});
