// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { PushToTalk } from './PushToTalk';
import {
  keyDown,
  keyDownOn,
  keyUp,
  mount,
  mouseDown,
  mouseUp,
  query,
  type Mounted,
} from '../test/harness';

interface Recorder {
  starts: number;
  stops: number;
}

async function render(
  overrides: Partial<{ disabled: boolean; isRecording: boolean; micLevel: number }> = {},
): Promise<{ mounted: Mounted; rec: Recorder }> {
  const rec: Recorder = { starts: 0, stops: 0 };
  const mounted = await mount(
    <PushToTalk
      isRecording={overrides.isRecording ?? false}
      micLevel={overrides.micLevel ?? 0}
      disabled={overrides.disabled ?? false}
      onStart={() => (rec.starts += 1)}
      onStop={() => (rec.stops += 1)}
    />,
  );
  return { mounted, rec };
}

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe('PushToTalk — spacebar', () => {
  it('starts on Space keydown and stops on keyup', async () => {
    const r = await render();
    mounted = r.mounted;
    await keyDown(' ', 'Space');
    expect(r.rec.starts).toBe(1);
    expect(r.rec.stops).toBe(0);
    await keyUp(' ', 'Space');
    expect(r.rec.stops).toBe(1);
  });

  it('ignores auto-repeat keydown so hold fires start exactly once', async () => {
    const r = await render();
    mounted = r.mounted;
    await keyDown(' ', 'Space'); // real press
    // Simulate held-key repeats.
    const repeat = new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: true });
    window.dispatchEvent(repeat);
    window.dispatchEvent(repeat);
    expect(r.rec.starts).toBe(1);
  });

  it('does nothing when disabled', async () => {
    const r = await render({ disabled: true });
    mounted = r.mounted;
    await keyDown(' ', 'Space');
    await keyUp(' ', 'Space');
    expect(r.rec.starts).toBe(0);
    expect(r.rec.stops).toBe(0);
  });

  it('ignores Space typed into a form field', async () => {
    const r = await render();
    mounted = r.mounted;
    const input = document.createElement('input');
    document.body.appendChild(input);
    await keyDownOn(input, ' ', 'Space');
    expect(r.rec.starts).toBe(0);
    input.remove();
  });
});

describe('PushToTalk — button', () => {
  it('starts on mousedown and stops on mouseup', async () => {
    const r = await render();
    mounted = r.mounted;
    const button = query(mounted.container, '.ptt__button');
    await mouseDown(button);
    expect(r.rec.starts).toBe(1);
    await mouseUp(button);
    expect(r.rec.stops).toBe(1);
  });

  it('reflects the recording state on the button', async () => {
    const r = await render({ isRecording: true, micLevel: 0.5 });
    mounted = r.mounted;
    const button = query<HTMLButtonElement>(mounted.container, '.ptt__button');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList.contains('is-recording')).toBe(true);
  });
});
