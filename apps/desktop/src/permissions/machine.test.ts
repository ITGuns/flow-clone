import { describe, it, expect } from 'vitest';
import { PermissionFlow, type PermissionFlowState } from './machine';
import { FakePermissionBridge } from './fake-bridge';

describe('PermissionFlow — the pre-prompt-before-OS-request invariant (guide §3, non-negotiable)', () => {
  it('start() only CHECKS; it never triggers the OS request', async () => {
    const bridge = new FakePermissionBridge({ microphone: 'undetermined' });
    const flow = new PermissionFlow('microphone', bridge);

    await flow.start();

    expect(flow.state).toBe('explaining'); // pre-prompt is shown first
    expect(bridge.countOf('checkMicrophone')).toBe(1);
    expect(bridge.countOf('requestMicrophone')).toBe(0); // OS prompt NOT yet fired
  });

  it('the OS request fires ONLY after acknowledge(), and exactly once', async () => {
    const bridge = new FakePermissionBridge({
      microphone: 'undetermined',
      requestResult: 'granted',
    });
    const flow = new PermissionFlow('microphone', bridge);
    await flow.start();
    expect(bridge.countOf('requestMicrophone')).toBe(0);

    await flow.acknowledge();

    expect(bridge.countOf('requestMicrophone')).toBe(1);
    expect(flow.state).toBe('granted');
  });

  it('acknowledge() from a non-explaining state is a no-op and never touches the bridge', async () => {
    const bridge = new FakePermissionBridge({ microphone: 'undetermined' });
    const flow = new PermissionFlow('microphone', bridge);

    // Called before start() — flow is `idle`.
    await flow.acknowledge();
    expect(flow.state).toBe('idle');
    expect(bridge.countOf('requestMicrophone')).toBe(0);

    // Reach `granted`, then a stray acknowledge must not re-request.
    await flow.start();
    await flow.acknowledge();
    expect(flow.state).toBe('granted');
    await flow.acknowledge();
    expect(bridge.countOf('requestMicrophone')).toBe(1);
  });
});

describe('PermissionFlow — initial-check routing', () => {
  it('already-granted resolves straight to granted with no pre-prompt', async () => {
    const bridge = new FakePermissionBridge({ microphone: 'granted' });
    const flow = new PermissionFlow('microphone', bridge);
    await flow.start();
    expect(flow.state).toBe('granted');
    expect(flow.isSatisfied).toBe(true);
    expect(bridge.countOf('requestMicrophone')).toBe(0);
  });

  it('already-denied routes to recovery(denied) — macOS will not re-prompt', async () => {
    const bridge = new FakePermissionBridge({ microphone: 'denied' });
    const flow = new PermissionFlow('microphone', bridge);
    await flow.start();
    expect(flow.state).toBe('recovery');
    expect(flow.reason).toBe('denied');
    expect(bridge.countOf('requestMicrophone')).toBe(0);
  });

  it('restricted routes to recovery(restricted)', async () => {
    const bridge = new FakePermissionBridge({ microphone: 'restricted' });
    const flow = new PermissionFlow('microphone', bridge);
    await flow.start();
    expect(flow.state).toBe('recovery');
    expect(flow.reason).toBe('restricted');
  });
});

describe('PermissionFlow — grant path', () => {
  it('undetermined → explaining → acknowledge → requesting → granted', async () => {
    const bridge = new FakePermissionBridge({
      microphone: 'undetermined',
      requestResult: 'granted',
    });
    const flow = new PermissionFlow('microphone', bridge);
    const seen: PermissionFlowState[] = [];
    flow.subscribe((s) => seen.push(s.state));

    await flow.start();
    await flow.acknowledge();

    expect(seen).toEqual(['explaining', 'requesting', 'granted']);
    expect(flow.state).toBe('granted');
  });
});

describe('PermissionFlow — deny → recovery → recheck → grant', () => {
  it('a refused request lands in recovery, then a Settings fix + recheck grants', async () => {
    const bridge = new FakePermissionBridge({
      microphone: 'undetermined',
      requestResult: 'denied',
    });
    const flow = new PermissionFlow('microphone', bridge);

    await flow.start();
    await flow.acknowledge();
    expect(flow.state).toBe('recovery');
    expect(flow.reason).toBe('denied');

    // User opens Settings (deep-link), flips the toggle, comes back and re-checks.
    await flow.openSettings();
    expect(bridge.countOf('openMicrophoneSettings')).toBe(1);
    bridge.setStatus('microphone', 'granted');

    await flow.recheck();
    expect(flow.state).toBe('granted');
    expect(flow.isSatisfied).toBe(true);
    // The OS prompt was only ever fired once — recovery uses check(), not request().
    expect(bridge.countOf('requestMicrophone')).toBe(1);
  });

  it('a recheck that is still denied stays in recovery', async () => {
    const bridge = new FakePermissionBridge({ microphone: 'denied' });
    const flow = new PermissionFlow('microphone', bridge);
    await flow.start();
    await flow.recheck();
    expect(flow.state).toBe('recovery');
    expect(flow.reason).toBe('denied');
  });
});

describe('PermissionFlow — accessibility on Windows is not-required', () => {
  it('a not-required check resolves to the not-required terminal with no UI or request', async () => {
    const bridge = new FakePermissionBridge({ platform: 'windows' });
    const flow = new PermissionFlow('accessibility', bridge);
    await flow.start();
    expect(flow.state).toBe('not-required');
    expect(flow.isSatisfied).toBe(true);
    expect(bridge.countOf('checkAccessibility')).toBe(1);
    // Never a microphone/accessibility OS prompt for a not-required capability.
    expect(bridge.countOf('requestMicrophone')).toBe(0);
  });

  it('accessibility explains first, then acknowledge deep-links the Accessibility pane (no OS prompt)', async () => {
    const bridge = new FakePermissionBridge({ accessibility: 'denied', platform: 'macos' });
    const flow = new PermissionFlow('accessibility', bridge);

    // Not-granted accessibility shows the explainer BEFORE any Settings interaction.
    await flow.start();
    expect(flow.state).toBe('explaining');

    // Acknowledging the explainer opens System Settings and rests in recovery — no mic request.
    await flow.acknowledge();
    expect(flow.state).toBe('recovery');
    expect(bridge.countOf('openAccessibilitySettings')).toBe(1);
    expect(bridge.countOf('openMicrophoneSettings')).toBe(0);
    expect(bridge.countOf('requestMicrophone')).toBe(0);

    // The recovery "Open Settings" affordance re-links the same pane.
    await flow.openSettings();
    expect(bridge.countOf('openAccessibilitySettings')).toBe(2);
  });
});
