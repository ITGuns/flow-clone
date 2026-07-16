import { describe, it, expect } from 'vitest';
import { DarwinTextInjector } from './text-injector';
import { MockMacBinding } from './mock-binding';

describe('DarwinTextInjector.inject', () => {
  it('maps a successful AX write', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = 'ax';
    const result = await new DarwinTextInjector(binding).inject('hello');
    expect(result).toEqual({ ok: true, method: 'ax' });
    expect(binding.injectCalls).toEqual(['hello']);
  });

  it('maps the clipboard fallback', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = 'clipboard-fallback';
    const result = await new DarwinTextInjector(binding).inject('hello');
    expect(result).toEqual({ ok: true, method: 'clipboard-fallback' });
  });

  it('maps no-permission to NO_PERMISSION', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = 'no-permission';
    const result = await new DarwinTextInjector(binding).inject('x');
    expect(result).toEqual({
      ok: false,
      code: 'NO_PERMISSION',
      message: expect.stringContaining('permission'),
    });
  });

  it('maps no-target to NO_TARGET', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = 'no-target';
    const result = await new DarwinTextInjector(binding).inject('x');
    expect(result).toMatchObject({ ok: false, code: 'NO_TARGET' });
  });

  it('maps inject-failed to INJECT_FAILED', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = 'inject-failed';
    const result = await new DarwinTextInjector(binding).inject('x');
    expect(result).toMatchObject({ ok: false, code: 'INJECT_FAILED' });
  });

  it('treats empty text as a no-op success without calling native', async () => {
    const binding = new MockMacBinding();
    const result = await new DarwinTextInjector(binding).inject('');
    expect(result).toEqual({ ok: true, method: 'ax' });
    expect(binding.injectCalls).toEqual([]);
  });

  it('never rejects: a thrown native call becomes INJECT_FAILED', async () => {
    const binding = new MockMacBinding();
    binding.injectResult = () => {
      throw new Error('CGEventPost boom');
    };
    const result = await new DarwinTextInjector(binding).inject('x');
    expect(result).toMatchObject({ ok: false, code: 'INJECT_FAILED' });
    expect(result.ok ? '' : result.message).toContain('CGEventPost boom');
  });

  it('maps an unrecognized native status to INJECT_FAILED', async () => {
    const binding = new MockMacBinding();
    // Simulate a future/garbled status the wrapper does not know.
    binding.injectResult = 'weird-status' as unknown as typeof binding.injectResult;
    const result = await new DarwinTextInjector(binding).inject('x');
    expect(result).toMatchObject({ ok: false, code: 'INJECT_FAILED' });
  });
});
