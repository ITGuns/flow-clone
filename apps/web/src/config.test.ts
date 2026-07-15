import { describe, it, expect } from 'vitest';
import { resolveApiBaseUrl, toWsUrl } from './config';

describe('resolveApiBaseUrl', () => {
  it('defaults to the api start() port 8080 when unset/blank', () => {
    expect(resolveApiBaseUrl(undefined)).toBe('http://localhost:8080');
    expect(resolveApiBaseUrl('   ')).toBe('http://localhost:8080');
  });

  it('honours an explicit origin and strips a trailing slash', () => {
    expect(resolveApiBaseUrl('https://api.undertone.app/')).toBe('https://api.undertone.app');
  });
});

describe('toWsUrl', () => {
  it('maps http → ws and appends /v1/stream', () => {
    expect(toWsUrl('http://localhost:8080')).toBe('ws://localhost:8080/v1/stream');
  });

  it('maps https → wss', () => {
    expect(toWsUrl('https://api.undertone.app')).toBe('wss://api.undertone.app/v1/stream');
  });
});
