import { describe, it, expect } from 'vitest';
import { createNativeModuleFrom } from './index';
import { MockMacBinding } from './mock-binding';

describe('createNativeModuleFrom', () => {
  it('wires all three managers over one binding', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = 'ax';
    binding.activeApp = { bundleId: 'com.apple.Terminal', appName: 'Terminal', windowTitle: 't' };
    binding.permission = 'granted';

    const mod = createNativeModuleFrom(binding);

    expect(mod.hotkeys.isSupported('F13')).toBe(true);
    expect(await mod.injector.inject('hi')).toEqual({ ok: true, method: 'ax' });
    expect(await mod.detector.getActiveApp()).toEqual({
      bundleId: 'com.apple.Terminal',
      appName: 'Terminal',
      windowTitle: 't',
    });
    expect(mod.checkPermission()).toBe('granted');
  });

  it('surfaces the current permission from the binding', () => {
    const binding = new MockMacBinding();
    binding.permission = 'denied';
    expect(createNativeModuleFrom(binding).checkPermission()).toBe('denied');
  });
});
