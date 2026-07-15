import { describe, it, expect } from 'vitest';
import { STYLE_OPTIONS, buildAppContext, styleToRegister } from './register';

describe('styleToRegister', () => {
  it('maps each style to its Register', () => {
    expect(styleToRegister('chat')).toBe('chat');
    expect(styleToRegister('email')).toBe('email');
    expect(styleToRegister('document')).toBe('document');
    expect(styleToRegister('code')).toBe('code');
  });

  it('offers exactly the four contract-backed styles', () => {
    expect(STYLE_OPTIONS.map((o) => o.id)).toEqual(['chat', 'email', 'document', 'code']);
  });
});

describe('buildAppContext', () => {
  it('identifies the web dashboard and carries the selected register', () => {
    expect(buildAppContext('email')).toEqual({
      bundleId: 'web.dashboard',
      appName: 'Undertone Web',
      windowTitle: '',
      register: 'email',
    });
  });
});
