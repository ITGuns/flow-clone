import { describe, expect, it } from 'vitest';
import { Win32TextInjector } from './text-injector';
import { FakeBinding } from './fake-binding';
import type { InjectResult } from '../types';

function expectFail(r: InjectResult): Extract<InjectResult, { ok: false }> {
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r)}`);
  return r;
}

describe('Win32TextInjector', () => {
  it('empty text is a no-op success without touching the foreground', async () => {
    const binding = new FakeBinding({ foreground: null });
    const injector = new Win32TextInjector(binding);
    expect(await injector.inject('')).toEqual({ ok: true, method: 'sendinput' });
    expect(binding.sentTexts).toEqual([]);
  });

  it('primary path: SendInput accepts all events → method sendinput', async () => {
    const binding = new FakeBinding();
    const injector = new Win32TextInjector(binding);
    const r = await injector.inject('héllo 👋');
    expect(r).toEqual({ ok: true, method: 'sendinput' });
    expect(binding.sentTexts).toEqual(['héllo 👋']);
    expect(binding.pastedTexts).toEqual([]); // no fallback
  });

  it('no foreground window → NO_TARGET', async () => {
    const injector = new Win32TextInjector(new FakeBinding({ foreground: null }));
    expect(expectFail(await injector.inject('hi')).code).toBe('NO_TARGET');
  });

  it('own HUD in foreground → NO_TARGET (never inject into ourselves)', async () => {
    const binding = new FakeBinding({
      foreground: { pid: 999, isOwnProcess: true, className: 'HUD', title: 'Undertone' },
    });
    const injector = new Win32TextInjector(binding);
    expect(expectFail(await injector.inject('hi')).code).toBe('NO_TARGET');
    expect(binding.sentTexts).toEqual([]); // never attempted
  });

  it('UIPI (elevated target, ERROR_ACCESS_DENIED) → NO_PERMISSION, no clipboard fallback', async () => {
    const binding = new FakeBinding({
      sendUnicode: (t) => ({ sent: t.length * 2, accepted: 0, lastError: 5 }),
    });
    const injector = new Win32TextInjector(binding);
    expect(expectFail(await injector.inject('sudo')).code).toBe('NO_PERMISSION');
    expect(binding.pastedTexts).toEqual([]); // Ctrl+V would be UIPI-blocked too
  });

  it('partial SendInput (non-UIPI) → clipboard fallback succeeds', async () => {
    const binding = new FakeBinding({
      sendUnicode: (t) => ({ sent: t.length * 2, accepted: 1, lastError: 0 }),
    });
    const injector = new Win32TextInjector(binding);
    const r = await injector.inject('report');
    expect(r).toEqual({ ok: true, method: 'clipboard-fallback' });
    expect(binding.pastedTexts).toEqual(['report']);
  });

  it('clipboard fallback also fails (non-UIPI) → INJECT_FAILED', async () => {
    const binding = new FakeBinding({
      sendUnicode: (t) => ({ sent: t.length * 2, accepted: 0, lastError: 0 }),
      clipboardPaste: () => ({ ok: false, lastError: 1418 }),
    });
    const injector = new Win32TextInjector(binding);
    expect(expectFail(await injector.inject('x')).code).toBe('INJECT_FAILED');
  });

  it('clipboard fallback blocked by UIPI → NO_PERMISSION', async () => {
    const binding = new FakeBinding({
      sendUnicode: (t) => ({ sent: t.length * 2, accepted: 0, lastError: 0 }),
      clipboardPaste: () => ({ ok: false, lastError: 5 }),
    });
    const injector = new Win32TextInjector(binding);
    expect(expectFail(await injector.inject('x')).code).toBe('NO_PERMISSION');
  });
});
