// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PermissionPrePrompt } from './PermissionPrePrompt';
import { prePromptCopy } from './permission-copy';
import { mount, click, buttonByText, query } from './dom-harness';

describe('PermissionPrePrompt — renders the explanation (guide §3 privacy posture)', () => {
  it('shows why the mic is needed and the do/dont privacy promise', async () => {
    const view = await mount(<PermissionPrePrompt kind="microphone" onAcknowledge={() => {}} />);
    const text = view.container.textContent ?? '';
    const copy = prePromptCopy('microphone');
    expect(text).toContain(copy.why);
    expect(text).toContain('never'); // the privacy promise ("never stores your audio", …)
    for (const line of copy.doesNot) expect(text).toContain(line);
    expect(text).toContain(copy.acknowledgeLabel);
    await view.unmount();
  });

  it('has dialog semantics wired to the title and description (a11y)', async () => {
    const view = await mount(<PermissionPrePrompt kind="microphone" onAcknowledge={() => {}} />);
    const dialog = query(view.container, '[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    const descId = dialog.getAttribute('aria-describedby');
    expect(titleId).toBeTruthy();
    expect(descId).toBeTruthy();
    // The referenced ids must resolve to real nodes with content. (useId ids contain ':', which is
    // invalid in a CSS selector, so resolve via getElementById rather than querySelector.)
    expect(document.getElementById(titleId!)?.textContent).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBeTruthy();
    await view.unmount();
  });

  it('moves keyboard focus to the primary action', async () => {
    const view = await mount(<PermissionPrePrompt kind="microphone" onAcknowledge={() => {}} />);
    const primary = query<HTMLButtonElement>(view.container, '.utp-btn-primary');
    expect(document.activeElement).toBe(primary);
    await view.unmount();
  });
});

describe('PermissionPrePrompt — fires only on explicit acknowledgement', () => {
  it('does NOT call onAcknowledge on mount, and calls it exactly once on click', async () => {
    const onAcknowledge = vi.fn();
    const view = await mount(
      <PermissionPrePrompt kind="microphone" onAcknowledge={onAcknowledge} />,
    );
    expect(onAcknowledge).not.toHaveBeenCalled(); // nothing fires just by rendering

    await click(buttonByText(view.container, prePromptCopy('microphone').acknowledgeLabel));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('renders the accessibility variant with the Settings CTA', async () => {
    const view = await mount(<PermissionPrePrompt kind="accessibility" onAcknowledge={() => {}} />);
    const copy = prePromptCopy('accessibility');
    expect(view.container.textContent ?? '').toContain(copy.acknowledgeLabel); // "Open System Settings"
    await view.unmount();
  });

  it('renders and fires the optional dismiss affordance', async () => {
    const onDismiss = vi.fn();
    const view = await mount(
      <PermissionPrePrompt kind="microphone" onAcknowledge={() => {}} onDismiss={onDismiss} />,
    );
    await click(buttonByText(view.container, prePromptCopy('microphone').dismissLabel));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('disables actions while busy', async () => {
    const view = await mount(
      <PermissionPrePrompt kind="microphone" onAcknowledge={() => {}} busy />,
    );
    const primary = query<HTMLButtonElement>(view.container, '.utp-btn-primary');
    expect(primary.disabled).toBe(true);
    await view.unmount();
  });
});
