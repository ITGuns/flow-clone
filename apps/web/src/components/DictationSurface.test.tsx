// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { DictationSurface } from './DictationSurface';
import { makeFakeDeps, type FakeDepsHandle } from '../test/fakes';
import {
  buttonByText,
  click,
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
  handle: FakeDepsHandle;
  copies: string[];
}

async function renderSurface(): Promise<Setup> {
  const handle = makeFakeDeps();
  const copies: string[] = [];
  mounted = await mount(
    <DictationSurface
      deps={handle.deps}
      micEnabledByDefault
      copy={(t) => {
        copies.push(t);
        return Promise.resolve(true);
      }}
    />,
  );
  return { handle, copies };
}

describe('DictationSurface — mic pre-prompt', () => {
  it('explains and gates the mic before revealing push-to-talk', async () => {
    const handle = makeFakeDeps();
    mounted = await mount(<DictationSurface deps={handle.deps} />);
    expect(text(mounted.container).toLowerCase()).toContain('turn on your microphone');
    expect(mounted.container.querySelector('.ptt__button')).toBeNull();
    await click(buttonByText(mounted.container, 'Enable microphone'));
    expect(mounted.container.querySelector('.ptt__button')).not.toBeNull();
  });
});

describe('DictationSurface — push-to-talk flow', () => {
  it('holds to record, releases to finalize, and streams partial → final → formatted', async () => {
    const { handle } = await renderSurface();
    const client = handle.client();
    expect(client.getStatus()).toBe('ready');

    await keyDown(' ', 'Space');
    expect(text(mounted!.container)).toContain('Listening');
    expect(client.beginCalls).toHaveLength(1);

    // partial streams while held
    await run(() => client.emitPartial(1, 'hello wor'));
    expect(text(mounted!.container)).toContain('hello wor');

    await keyUp(' ', 'Space');
    expect(client.ended).toBe(1);
    expect(handle.captures[0]!.stopped).toBe(1);

    await run(() => client.emitFinal(1, 'hello world'));
    await run(() => client.emitDelta(1, 'Hello '));
    await run(() => client.emitDelta(1, 'world.'));
    await run(() => client.emitDone(1, 'Hello world.', 2));

    const body = text(mounted!.container);
    expect(body).toContain('Hello world.');
    expect(body).toContain('2 words');
  });

  it('stamps the selected style into the utterance.start register (§4.3)', async () => {
    const { handle } = await renderSurface();
    await click(buttonByText(mounted!.container, 'Email'));
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    const ctx = handle.client().beginCalls.at(-1)!;
    expect(ctx.register).toBe('email');
    expect(ctx.bundleId).toBe('web.dashboard');
  });

  it('copies the formatted result', async () => {
    const { handle, copies } = await renderSurface();
    const client = handle.client();
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => client.emitDone(1, 'Copy me.', 2));
    await click(buttonByText(mounted!.container, 'Copy'));
    expect(copies).toEqual(['Copy me.']);
  });
});

describe('DictationSurface — §8 honest states', () => {
  it('shows the raw text with an "unformatted" note on a FORMAT_* fallback', async () => {
    const { handle } = await renderSurface();
    const client = handle.client();
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => client.emitFinal(1, 'raw words here'));
    await run(() => client.emitDone(1, 'raw words here', 3, true));
    const body = text(mounted!.container).toLowerCase();
    expect(body).toContain('raw words here');
    expect(body).toContain('unformatted');
  });

  it('keeps the result but flags QUOTA_EXCEEDED with an upgrade hint', async () => {
    const { handle } = await renderSurface();
    const client = handle.client();
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => client.emitDone(1, 'Kept words.', 2));
    await run(() => client.emitQuota(1));
    const body = text(mounted!.container).toLowerCase();
    expect(body).toContain('kept words.');
    expect(body).toContain('weekly limit reached');
  });

  it('surfaces a pipeline error banner', async () => {
    const { handle } = await renderSurface();
    const client = handle.client();
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    await run(() => client.emitError('ASR_UNAVAILABLE', 'The transcription service is down.'));
    expect(text(mounted!.container)).toContain('The transcription service is down.');
  });
});
