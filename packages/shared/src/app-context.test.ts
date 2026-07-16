import { describe, it, expect } from 'vitest';
import type { AppContext } from './types';
import { buildAppContext, WINDOW_TITLE_MAX } from './app-context';

function raw(over: Partial<Omit<AppContext, 'register'>> = {}): Omit<AppContext, 'register'> {
  return { bundleId: '', appName: '', windowTitle: '', ...over };
}

describe('buildAppContext — register attachment', () => {
  it('attaches the derived register and preserves the raw fields', () => {
    const ctx = buildAppContext(
      raw({ bundleId: 'com.tinyspeck.slackmacgap', appName: 'Slack', windowTitle: 'general' }),
    );
    expect(ctx).toEqual({
      bundleId: 'com.tinyspeck.slackmacgap',
      appName: 'Slack',
      windowTitle: 'general',
      register: 'chat',
    });
  });

  it('derives a browser register from the window title', () => {
    const ctx = buildAppContext(
      raw({ bundleId: 'chrome.exe', appName: 'Google Chrome', windowTitle: 'Inbox - Gmail' }),
    );
    expect(ctx.register).toBe('email');
  });

  it('falls back to unknown for an unrecognized app', () => {
    const ctx = buildAppContext(raw({ bundleId: 'mystery.exe', appName: 'Mystery' }));
    expect(ctx.register).toBe('unknown');
  });
});

describe('buildAppContext — windowTitle hardening', () => {
  it('truncates an overlong windowTitle to 256 chars (defense in depth)', () => {
    const long = 'x'.repeat(500);
    const ctx = buildAppContext(raw({ bundleId: 'notepad.exe', windowTitle: long }));
    expect(ctx.windowTitle.length).toBe(WINDOW_TITLE_MAX);
    expect(ctx.windowTitle.length).toBe(256);
  });

  it('leaves a normal-length windowTitle unchanged', () => {
    const ctx = buildAppContext(
      raw({ bundleId: 'notepad.exe', windowTitle: 'Untitled - Notepad' }),
    );
    expect(ctx.windowTitle).toBe('Untitled - Notepad');
  });

  it('trims surrounding whitespace from the windowTitle', () => {
    const ctx = buildAppContext(raw({ bundleId: 'notepad.exe', windowTitle: '  My Note  ' }));
    expect(ctx.windowTitle).toBe('My Note');
  });

  it('handles an empty windowTitle without throwing', () => {
    expect(() => buildAppContext(raw({ bundleId: 'slack.exe' }))).not.toThrow();
    expect(buildAppContext(raw({ bundleId: 'slack.exe' })).windowTitle).toBe('');
  });

  it('truncation runs before register derivation is observable on output', () => {
    // A title that is a valid hint but padded past the cap still classifies and is trimmed.
    const padded = 'Inbox - Gmail' + ' '.repeat(400);
    const ctx = buildAppContext(raw({ bundleId: 'chrome.exe', windowTitle: padded }));
    expect(ctx.register).toBe('email');
    expect(ctx.windowTitle.length).toBeLessThanOrEqual(256);
  });
});

describe('buildAppContext — never throws on garbage', () => {
  it('all-empty raw input yields an unknown-register context', () => {
    const ctx = buildAppContext(raw());
    expect(ctx.register).toBe('unknown');
    expect(ctx.windowTitle).toBe('');
  });
});
