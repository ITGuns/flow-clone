import { describe, it, expect } from 'vitest';
import { ERROR_CODES, ERROR_TAXONOMY, UndertoneError, type ErrorCode, isRetryable } from './errors';

// The §8 table, transcribed. `retryable` here is the wire boolean the client dispatches on;
// INTERNAL's "maybe" resolves to the safe default `false`.
const EXPECTED_RETRYABLE: Record<ErrorCode, boolean> = {
  AUTH_EXPIRED: true,
  AUTH_INVALID: false,
  SESSION_INVALID: false,
  PROTO_ERROR: false,
  RATE_LIMITED: true,
  QUOTA_EXCEEDED: false,
  ASR_UNAVAILABLE: true,
  ASR_TIMEOUT: true,
  FORMAT_UNAVAILABLE: true,
  FORMAT_TIMEOUT: true,
  INJECT_FAILED: false,
  OFFLINE_BUFFERED: true,
  INTERNAL: false,
};

describe('error taxonomy completeness', () => {
  it('defines every §8 code exactly once', () => {
    const expectedCodes = Object.keys(EXPECTED_RETRYABLE).sort();
    expect([...ERROR_CODES].sort()).toEqual(expectedCodes);
    expect(ERROR_CODES.length).toBe(13);
  });

  it('keys each taxonomy entry to its own code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_TAXONOMY[code].code).toBe(code);
    }
  });

  it('gives every entry a non-empty description and client behavior', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_TAXONOMY[code].description.length).toBeGreaterThan(0);
      expect(ERROR_TAXONOMY[code].clientBehavior.length).toBeGreaterThan(0);
    }
  });
});

describe('retryable flags match the §8 table', () => {
  for (const code of Object.keys(EXPECTED_RETRYABLE) as ErrorCode[]) {
    it(`${code} → retryable=${String(EXPECTED_RETRYABLE[code])}`, () => {
      expect(ERROR_TAXONOMY[code].retryable).toBe(EXPECTED_RETRYABLE[code]);
      expect(isRetryable(code)).toBe(EXPECTED_RETRYABLE[code]);
    });
  }

  it('flags backoff for exactly the rate/availability codes', () => {
    const backoff = ERROR_CODES.filter((c) => ERROR_TAXONOMY[c].requiresBackoff).sort();
    expect(backoff).toEqual(
      [
        'ASR_TIMEOUT',
        'ASR_UNAVAILABLE',
        'FORMAT_TIMEOUT',
        'FORMAT_UNAVAILABLE',
        'OFFLINE_BUFFERED',
        'RATE_LIMITED',
      ].sort(),
    );
  });
});

describe('UndertoneError', () => {
  it('adopts the taxonomy default retryable and description', () => {
    const err = new UndertoneError('ASR_TIMEOUT');
    expect(err.code).toBe('ASR_TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe(ERROR_TAXONOMY.ASR_TIMEOUT.description);
    expect(err).toBeInstanceOf(Error);
  });

  it('lets a caller override retryable (resolving INTERNAL "maybe" when transient)', () => {
    const def = new UndertoneError('INTERNAL');
    expect(def.retryable).toBe(false);
    const transient = new UndertoneError('INTERNAL', 'blip', { retryable: true });
    expect(transient.retryable).toBe(true);
    expect(transient.message).toBe('blip');
  });

  it('carries an optional utteranceId and cause', () => {
    const cause = new Error('root');
    const err = new UndertoneError('FORMAT_UNAVAILABLE', 'down', { utteranceId: 12, cause });
    expect(err.utteranceId).toBe(12);
    expect(err.cause).toBe(cause);
  });
});
