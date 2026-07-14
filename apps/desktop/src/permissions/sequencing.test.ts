import { describe, it, expect } from 'vitest';
import { OnboardingPermissions } from './sequencing';
import { FakePermissionBridge } from './fake-bridge';

describe('OnboardingPermissions — sequencing order (microphone first, then accessibility)', () => {
  it('macOS: mic is fully resolved before accessibility is ever started', async () => {
    const bridge = new FakePermissionBridge({
      platform: 'macos',
      microphone: 'undetermined',
      accessibility: 'undetermined',
      requestResult: 'granted',
    });
    const onboarding = new OnboardingPermissions(bridge);

    await onboarding.start();
    // First stop is the microphone pre-prompt; accessibility not yet touched.
    expect(onboarding.activeKind).toBe('microphone');
    expect(onboarding.flowFor('accessibility').state).toBe('idle');
    expect(bridge.calls).toEqual(['checkMicrophone']);

    await onboarding.acknowledgeActive(); // grant mic → advance to accessibility
    expect(bridge.countOf('requestMicrophone')).toBe(1);
    expect(onboarding.activeKind).toBe('accessibility');
    expect(onboarding.flowFor('accessibility').state).toBe('explaining');

    // Accessibility has no OS prompt: acknowledging the explainer deep-links to Settings and rests
    // in recovery until the user toggles it and re-checks.
    await onboarding.acknowledgeActive();
    expect(bridge.countOf('openAccessibilitySettings')).toBe(1);
    expect(onboarding.flowFor('accessibility').state).toBe('recovery');
    expect(onboarding.readiness.ready).toBe(false);

    bridge.setStatus('accessibility', 'granted'); // user enabled it in System Settings
    await onboarding.recheckActive();

    expect(onboarding.isComplete).toBe(true);
    expect(onboarding.activeKind).toBeUndefined();
    expect(onboarding.readiness.ready).toBe(true);
    expect(onboarding.readiness.states).toEqual({
      microphone: 'granted',
      accessibility: 'granted',
    });
  });

  it('Windows: accessibility auto-skips as not-required after mic is granted', async () => {
    const bridge = new FakePermissionBridge({
      platform: 'windows',
      microphone: 'undetermined',
      requestResult: 'granted',
    });
    const onboarding = new OnboardingPermissions(bridge);

    await onboarding.start();
    expect(onboarding.activeKind).toBe('microphone');

    await onboarding.acknowledgeActive();

    expect(onboarding.isComplete).toBe(true);
    expect(onboarding.readiness.ready).toBe(true);
    expect(onboarding.readiness.states.accessibility).toBe('not-required');
    // No accessibility OS prompt was ever triggered.
    expect(bridge.countOf('requestMicrophone')).toBe(1);
    expect(bridge.calls).not.toContain('openAccessibilitySettings');
  });

  it('an already-granted microphone advances immediately to accessibility on start()', async () => {
    const bridge = new FakePermissionBridge({
      platform: 'macos',
      microphone: 'granted',
      accessibility: 'undetermined',
    });
    const onboarding = new OnboardingPermissions(bridge);
    await onboarding.start();
    expect(onboarding.activeKind).toBe('accessibility');
    expect(onboarding.flowFor('microphone').state).toBe('granted');
    expect(bridge.countOf('requestMicrophone')).toBe(0);
  });

  it('readiness is not ready while the active flow sits in recovery', async () => {
    const bridge = new FakePermissionBridge({ platform: 'macos', microphone: 'denied' });
    const onboarding = new OnboardingPermissions(bridge);
    await onboarding.start();
    expect(onboarding.activeKind).toBe('microphone');
    expect(onboarding.flowFor('microphone').state).toBe('recovery');
    expect(onboarding.readiness.ready).toBe(false);
    expect(onboarding.isComplete).toBe(false);
  });

  it('notifies subscribers as the sequence progresses', async () => {
    const bridge = new FakePermissionBridge({ platform: 'windows', requestResult: 'granted' });
    const onboarding = new OnboardingPermissions(bridge);
    let notifications = 0;
    onboarding.subscribe(() => (notifications += 1));
    await onboarding.start();
    await onboarding.acknowledgeActive();
    expect(notifications).toBeGreaterThan(0);
  });
});
