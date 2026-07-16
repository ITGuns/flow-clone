import { describe, it, expect, vi } from 'vitest';
import { DarwinHotkeyManager } from './hotkey-manager';
import { MockMacBinding } from './mock-binding';
import { MOD_CMD, MOD_SHIFT } from './binding';

describe('DarwinHotkeyManager.isSupported', () => {
  const mgr = new DarwinHotkeyManager(new MockMacBinding());

  it('accepts valid accelerators', () => {
    expect(mgr.isSupported('F13')).toBe(true);
    expect(mgr.isSupported('Command+Shift+D')).toBe(true);
  });

  it('rejects invalid accelerators', () => {
    expect(mgr.isSupported('')).toBe(false);
    expect(mgr.isSupported('Command')).toBe(false);
    expect(mgr.isSupported('Command+Enter')).toBe(false);
  });
});

describe('DarwinHotkeyManager.register', () => {
  it('resolves the accelerator and registers with the binding', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    mgr.register('Command+Shift+D', () => {});
    expect(binding.registrations).toHaveLength(1);
    expect(binding.registrations[0]?.keyCode).toBe(0x02);
    expect(binding.registrations[0]?.modifiers).toBe(MOD_CMD | MOD_SHIFT);
  });

  it('throws on an unsupported accelerator and does not register', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    expect(() => mgr.register('Command', () => {})).toThrow(/Unsupported accelerator/);
    expect(binding.registrations).toHaveLength(0);
  });

  it('fans out down/up transitions to the subscriber', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    const phases: string[] = [];
    mgr.register('F13', (p) => phases.push(p));
    const handle = binding.registrations[0]!.handle;
    binding.fire(handle, 'down');
    binding.fire(handle, 'up');
    expect(phases).toEqual(['down', 'up']);
  });

  it('de-bounces key auto-repeat (repeated downs collapse to one)', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    const phases: string[] = [];
    mgr.register('F13', (p) => phases.push(p));
    const handle = binding.registrations[0]!.handle;
    binding.fire(handle, 'down');
    binding.fire(handle, 'down'); // auto-repeat
    binding.fire(handle, 'down'); // auto-repeat
    binding.fire(handle, 'up');
    expect(phases).toEqual(['down', 'up']);
  });

  it('ignores an up with no preceding down', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    const phases: string[] = [];
    mgr.register('F13', (p) => phases.push(p));
    const handle = binding.registrations[0]!.handle;
    binding.fire(handle, 'up');
    expect(phases).toEqual([]);
  });

  it('supports repeated press cycles', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    const phases: string[] = [];
    mgr.register('F13', (p) => phases.push(p));
    const handle = binding.registrations[0]!.handle;
    binding.fire(handle, 'down');
    binding.fire(handle, 'up');
    binding.fire(handle, 'down');
    binding.fire(handle, 'up');
    expect(phases).toEqual(['down', 'up', 'down', 'up']);
  });

  it('unregisters the binding handle and stops delivering events', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    const cb = vi.fn();
    const unregister = mgr.register('F13', cb);
    const reg = binding.registrations[0]!;
    unregister();
    expect(reg.registered).toBe(false);
    binding.fire(reg.handle, 'down'); // late event after unregister
    expect(cb).not.toHaveBeenCalled();
  });

  it('is idempotent on repeated unregister', () => {
    const binding = new MockMacBinding();
    const mgr = new DarwinHotkeyManager(binding);
    const unregister = mgr.register('F13', () => {});
    const unregisterSpy = vi.spyOn(binding, 'hotkeyUnregister');
    unregister();
    unregister();
    expect(unregisterSpy).toHaveBeenCalledTimes(1);
  });
});
