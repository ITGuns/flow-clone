import { describe, it, expect } from 'vitest';
import { loadNativeModule, NativeUnavailableError } from './index';
import type { NativeModule } from './types';

const fakeModule = {} as NativeModule;

describe('loadNativeModule', () => {
  it('imports the platform directory and calls createNativeModule', async () => {
    const mod = await loadNativeModule('darwin', async () => ({
      createNativeModule: () => fakeModule,
    }));
    expect(mod).toBe(fakeModule);
  });

  it('supports win32 selection (task 2b lands the implementation)', async () => {
    let importedFor = '';
    await loadNativeModule('win32', async () => {
      importedFor = 'win32';
      return { createNativeModule: () => fakeModule };
    });
    expect(importedFor).toBe('win32');
  });

  it('throws NativeUnavailableError on an unsupported platform without importing', async () => {
    let imported = false;
    await expect(
      loadNativeModule('linux', async () => {
        imported = true;
        return {};
      }),
    ).rejects.toBeInstanceOf(NativeUnavailableError);
    expect(imported).toBe(false);
  });

  it('wraps a failed import (addon absent) as NativeUnavailableError with a cause', async () => {
    const cause = new Error('Cannot find module undertone_mac.node');
    await expect(
      loadNativeModule('darwin', async () => {
        throw cause;
      }),
    ).rejects.toMatchObject({
      name: 'NativeUnavailableError',
      cause,
    });
  });

  it('throws NativeUnavailableError when the module lacks createNativeModule', async () => {
    await expect(loadNativeModule('darwin', async () => ({ nope: true }))).rejects.toBeInstanceOf(
      NativeUnavailableError,
    );
  });

  it('surfaces a clear message mentioning native module availability', async () => {
    await expect(loadNativeModule('freebsd', async () => ({}))).rejects.toThrow(
      /native module unavailable on this platform\/build/,
    );
  });
});
