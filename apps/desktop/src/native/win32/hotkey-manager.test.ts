import { describe, expect, it, vi } from 'vitest';
import { Win32HotkeyManager } from './hotkey-manager';
import { FakeBinding } from './fake-binding';

describe('Win32HotkeyManager', () => {
  it('registers the parsed VK and maps isDown → down/up phases', () => {
    const binding = new FakeBinding();
    const mgr = new Win32HotkeyManager(binding);
    const phases: Array<'down' | 'up'> = [];

    const unregister = mgr.register('F8', (phase) => phases.push(phase));

    // One hotkey registered, at the F8 VK.
    expect(binding.hotkeys.size).toBe(1);
    const [handle, hk] = [...binding.hotkeys.entries()][0]!;
    expect(hk.vk).toBe(0x77);

    binding.fire(handle, true);
    binding.fire(handle, false);
    expect(phases).toEqual(['down', 'up']);

    unregister();
    expect(binding.hotkeys.get(handle)?.active).toBe(false);
  });

  it('re-entrancy guard: ignores auto-repeat downs and stray ups (transitions only, §3)', () => {
    const binding = new FakeBinding();
    const mgr = new Win32HotkeyManager(binding);
    const phases: Array<'down' | 'up'> = [];
    mgr.register('Space', (phase) => phases.push(phase));
    const handle = [...binding.hotkeys.keys()][0]!;

    // OS key auto-repeat delivers a stream of key-downs while held; a stray up may arrive first.
    binding.fire(handle, false); // stray up before any down → ignored
    binding.fire(handle, true); // real press → down
    binding.fire(handle, true); // auto-repeat → ignored
    binding.fire(handle, true); // auto-repeat → ignored
    binding.fire(handle, false); // release → up
    binding.fire(handle, false); // duplicate release → ignored

    expect(phases).toEqual(['down', 'up']);
  });

  it('re-entrancy guard: a fresh press after release emits a new down/up cycle', () => {
    const binding = new FakeBinding();
    const mgr = new Win32HotkeyManager(binding);
    const phases: Array<'down' | 'up'> = [];
    mgr.register('F8', (phase) => phases.push(phase));
    const handle = [...binding.hotkeys.keys()][0]!;

    binding.fire(handle, true);
    binding.fire(handle, false);
    binding.fire(handle, true);
    binding.fire(handle, false);

    expect(phases).toEqual(['down', 'up', 'down', 'up']);
  });

  it('re-entrancy guard is per-registration (independent press state)', () => {
    const binding = new FakeBinding();
    const mgr = new Win32HotkeyManager(binding);
    const a: string[] = [];
    const b: string[] = [];
    mgr.register('F8', (p) => a.push(p));
    mgr.register('F9', (p) => b.push(p));
    const [ha, hb] = [...binding.hotkeys.keys()];

    binding.fire(ha!, true); // A down
    binding.fire(hb!, true); // B down (independent of A)
    binding.fire(ha!, true); // A auto-repeat → ignored
    binding.fire(hb!, false); // B up
    binding.fire(ha!, false); // A up

    expect(a).toEqual(['down', 'up']);
    expect(b).toEqual(['down', 'up']);
  });

  it('throws on an unsupported accelerator', () => {
    const mgr = new Win32HotkeyManager(new FakeBinding());
    expect(() => mgr.register('Ctrl+Alt', () => {})).toThrow(/Unsupported accelerator/);
  });

  it('unregister is idempotent (never double-frees the native hook)', () => {
    const binding = new FakeBinding();
    const spy = vi.spyOn(binding, 'hotkeyUnregister');
    const mgr = new Win32HotkeyManager(binding);

    const unregister = mgr.register('Space', () => {});
    unregister();
    unregister();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('supports multiple concurrent registrations with independent callbacks', () => {
    const binding = new FakeBinding();
    const mgr = new Win32HotkeyManager(binding);
    const a: string[] = [];
    const b: string[] = [];

    mgr.register('F8', (p) => a.push(p));
    mgr.register('F9', (p) => b.push(p));
    const handles = [...binding.hotkeys.keys()];

    binding.fire(handles[0]!, true);
    binding.fire(handles[1]!, true);
    expect(a).toEqual(['down']);
    expect(b).toEqual(['down']);
  });

  it('isSupported mirrors parse success', () => {
    const mgr = new Win32HotkeyManager(new FakeBinding());
    expect(mgr.isSupported('F8')).toBe(true);
    expect(mgr.isSupported('CommandOrControl+Shift+Space')).toBe(true);
    expect(mgr.isSupported('Ctrl+Alt')).toBe(false);
    expect(mgr.isSupported('')).toBe(false);
  });
});
