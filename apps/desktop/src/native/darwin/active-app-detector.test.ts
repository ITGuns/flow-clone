import { describe, it, expect } from 'vitest';
import { DarwinActiveAppDetector } from './active-app-detector';
import { MockMacBinding } from './mock-binding';

describe('DarwinActiveAppDetector.getActiveApp', () => {
  it('passes through bundleId, appName, and windowTitle', async () => {
    const binding = new MockMacBinding();
    binding.activeApp = {
      bundleId: 'com.tinyspeck.slackmacgap',
      appName: 'Slack',
      windowTitle: 'general — Acme',
    };
    const ctx = await new DarwinActiveAppDetector(binding).getActiveApp();
    expect(ctx).toEqual({
      bundleId: 'com.tinyspeck.slackmacgap',
      appName: 'Slack',
      windowTitle: 'general — Acme',
    });
  });

  it('does not include a register field (Omit<AppContext, "register">)', async () => {
    const binding = new MockMacBinding();
    const ctx = await new DarwinActiveAppDetector(binding).getActiveApp();
    expect('register' in ctx).toBe(false);
  });

  it('preserves an empty window title', async () => {
    const binding = new MockMacBinding();
    binding.activeApp = { bundleId: 'com.apple.finder', appName: 'Finder', windowTitle: '' };
    const ctx = await new DarwinActiveAppDetector(binding).getActiveApp();
    expect(ctx.windowTitle).toBe('');
  });

  it('truncates windowTitle to 256 chars (CONTRACTS §1)', async () => {
    const binding = new MockMacBinding();
    binding.activeApp = {
      bundleId: 'com.example',
      appName: 'Example',
      windowTitle: 'x'.repeat(500),
    };
    const ctx = await new DarwinActiveAppDetector(binding).getActiveApp();
    expect(ctx.windowTitle).toHaveLength(256);
  });
});
