import { describe, expect, it } from 'vitest';
import { Win32ActiveAppDetector } from './active-app-detector';
import { FakeBinding } from './fake-binding';

describe('Win32ActiveAppDetector', () => {
  it('maps native facts to AppContext (minus register)', async () => {
    const binding = new FakeBinding({
      activeApp: { exeName: 'Code.exe', appName: 'Visual Studio Code', title: 'index.ts', pid: 1 },
    });
    const detector = new Win32ActiveAppDetector(binding);
    expect(await detector.getActiveApp()).toEqual({
      bundleId: 'Code.exe',
      appName: 'Visual Studio Code',
      windowTitle: 'index.ts',
    });
  });

  it('falls back to the executable name when appName is empty', async () => {
    const binding = new FakeBinding({
      activeApp: { exeName: 'mystery.exe', appName: '', title: '', pid: 2 },
    });
    const detector = new Win32ActiveAppDetector(binding);
    const ctx = await detector.getActiveApp();
    expect(ctx.appName).toBe('mystery.exe');
    expect(ctx.windowTitle).toBe('');
  });

  it('truncates window titles to 256 chars (CONTRACTS §1)', async () => {
    const longTitle = 'x'.repeat(500);
    const binding = new FakeBinding({
      activeApp: { exeName: 'chrome.exe', appName: 'Chrome', title: longTitle, pid: 3 },
    });
    const detector = new Win32ActiveAppDetector(binding);
    const ctx = await detector.getActiveApp();
    expect(ctx.windowTitle).toHaveLength(256);
  });
});
