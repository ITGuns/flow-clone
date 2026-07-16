// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PermissionFlow, FakePermissionBridge } from '../../permissions';
import { PermissionFlowView } from './PermissionFlowView';
import { mount, click, buttonByText } from './dom-harness';
import { prePromptCopy } from './permission-copy';

/** Drive a flow to `explaining`, then mount the view over it. */
async function mountExplaining(bridge: FakePermissionBridge) {
  const flow = new PermissionFlow('microphone', bridge);
  await flow.start();
  expect(flow.state).toBe('explaining');
  const view = await mount(<PermissionFlowView flow={flow} platform="macos" />);
  return { flow, view };
}

describe('PermissionFlowView — the pre-prompt fires the OS request ONLY on acknowledge', () => {
  it('shows the explanation with the OS request NOT yet triggered', async () => {
    const bridge = new FakePermissionBridge({
      microphone: 'undetermined',
      requestResult: 'granted',
    });
    const { view } = await mountExplaining(bridge);

    // The explanation is on screen…
    expect(view.container.textContent ?? '').toContain(prePromptCopy('microphone').why);
    // …and no OS prompt has been requested just by rendering it.
    expect(bridge.countOf('requestMicrophone')).toBe(0);
    await view.unmount();
  });

  it('clicking Continue triggers exactly one OS request and advances to granted', async () => {
    const bridge = new FakePermissionBridge({
      microphone: 'undetermined',
      requestResult: 'granted',
    });
    const { view } = await mountExplaining(bridge);

    await click(buttonByText(view.container, prePromptCopy('microphone').acknowledgeLabel));

    expect(bridge.countOf('requestMicrophone')).toBe(1);
    expect(view.container.textContent ?? '').toContain('granted');
    await view.unmount();
  });

  it('a refused request renders the recovery surface with Settings + Re-check', async () => {
    const bridge = new FakePermissionBridge({
      microphone: 'undetermined',
      requestResult: 'denied',
    });
    const { view } = await mountExplaining(bridge);

    await click(buttonByText(view.container, prePromptCopy('microphone').acknowledgeLabel));

    const text = view.container.textContent ?? '';
    expect(text).toContain('System Settings');
    expect(buttonByText(view.container, 'Re-check')).toBeTruthy();

    // Simulate the user enabling it in Settings, then re-checking from the UI.
    await click(buttonByText(view.container, 'Open System Settings'));
    expect(bridge.countOf('openMicrophoneSettings')).toBe(1);
    bridge.setStatus('microphone', 'granted');
    await click(buttonByText(view.container, 'Re-check'));

    expect(view.container.textContent ?? '').toContain('granted');
    // The OS prompt was only ever fired once (the acknowledge) — recovery re-checks, never re-requests.
    expect(bridge.countOf('requestMicrophone')).toBe(1);
    await view.unmount();
  });

  it('renders nothing when the permission is not required on this platform', async () => {
    const bridge = new FakePermissionBridge({ platform: 'windows' });
    const flow = new PermissionFlow('accessibility', bridge);
    await flow.start();
    expect(flow.state).toBe('not-required');
    const view = await mount(<PermissionFlowView flow={flow} platform="windows" />);
    expect(view.container.textContent ?? '').toBe('');
    await view.unmount();
  });
});
