import { describe, it, expect } from 'vitest';
import {
  StripeSignatureError,
  computeSignature,
  signStripePayload,
  verifyStripeSignature,
} from './stripe-signature';

const SECRET = 'whsec_test_secret';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed payload', () => {
    const header = signStripePayload(PAYLOAD, SECRET);
    expect(() => verifyStripeSignature(PAYLOAD, header, SECRET)).not.toThrow();
  });

  it('accepts a Buffer payload identically to a string', () => {
    const header = signStripePayload(PAYLOAD, SECRET);
    expect(() => verifyStripeSignature(Buffer.from(PAYLOAD), header, SECRET)).not.toThrow();
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const header = signStripePayload(PAYLOAD, SECRET);
    expect(() => verifyStripeSignature(`${PAYLOAD} `, header, SECRET)).toThrow(
      StripeSignatureError,
    );
  });

  it('rejects the wrong secret', () => {
    const header = signStripePayload(PAYLOAD, SECRET);
    expect(() => verifyStripeSignature(PAYLOAD, header, 'whsec_other')).toThrow(
      StripeSignatureError,
    );
  });

  it('rejects a missing header', () => {
    expect(() => verifyStripeSignature(PAYLOAD, '', SECRET)).toThrow(/missing/);
  });

  it('rejects a header with no v1 signature', () => {
    expect(() => verifyStripeSignature(PAYLOAD, 't=123', SECRET)).toThrow(/no v1 signature/);
  });

  it('rejects a header with no timestamp', () => {
    const sig = computeSignature(PAYLOAD, 123, SECRET);
    expect(() => verifyStripeSignature(PAYLOAD, `v1=${sig}`, SECRET)).toThrow(/no timestamp/);
  });

  it('rejects a stale timestamp outside the tolerance window', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 10_000;
    const header = signStripePayload(PAYLOAD, SECRET, oldTs);
    expect(() => verifyStripeSignature(PAYLOAD, header, SECRET, { toleranceSec: 300 })).toThrow(
      /tolerance/,
    );
  });

  it('accepts a stale timestamp when tolerance is disabled (0)', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 10_000;
    const header = signStripePayload(PAYLOAD, SECRET, oldTs);
    expect(() => verifyStripeSignature(PAYLOAD, header, SECRET, { toleranceSec: 0 })).not.toThrow();
  });

  it('uses the injected clock for tolerance', () => {
    const ts = 1_000_000;
    const header = signStripePayload(PAYLOAD, SECRET, ts);
    expect(() =>
      verifyStripeSignature(PAYLOAD, header, SECRET, { nowMs: ts * 1000 }),
    ).not.toThrow();
  });
});
