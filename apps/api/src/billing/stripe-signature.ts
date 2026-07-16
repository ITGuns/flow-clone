// Stripe webhook signature verification — CONTRACTS §5 (`POST /v1/webhooks/stripe` → 400 on bad
// sig; no bearer auth, the signature IS the auth). Implements Stripe's documented scheme
// (`t=<unix>,v1=<hex hmac>` over `"<t>.<rawBody>"`, HMAC-SHA256) with node crypto and a
// timing-safe compare, so the security-critical check is identical in real and mock modes and is
// fully testable keyless. The Stripe SDK's own `constructEvent` uses the same scheme; the real
// client wraps this helper (not the SDK) so prod and tests exercise one code path.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Raised when a webhook payload's signature does not verify — the route maps this to HTTP 400. */
export class StripeSignatureError extends Error {
  constructor(message = 'stripe signature verification failed') {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

/** Default replay-tolerance window (seconds) — matches Stripe's SDK default. 0 disables the check. */
export const DEFAULT_SIGNATURE_TOLERANCE_SEC = 300;

const SCHEME = 'v1';

export interface VerifyOptions {
  /** Reject timestamps more than this many seconds from `nowMs`. Default 300; 0 disables. */
  toleranceSec?: number;
  /** Injected clock for deterministic tests. */
  nowMs?: number;
}

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

function parseHeader(header: string): ParsedHeader {
  let timestamp = -1;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') {
      const n = Number(value);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === SCHEME) {
      signatures.push(value);
    }
  }
  return { timestamp, signatures };
}

/** Compute the expected `v1` HMAC-SHA256 hex signature for a payload + timestamp under `secret`. */
export function computeSignature(payload: string, timestampSec: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestampSec}.${payload}`, 'utf8').digest('hex');
}

/**
 * Verify a Stripe-Signature header against the raw request body. Throws {@link StripeSignatureError}
 * on a missing header, missing timestamp/signature, no matching signature, or a stale timestamp.
 * Returns void on success. `payload` must be the EXACT bytes Stripe signed (raw body, unparsed).
 */
export function verifyStripeSignature(
  payload: string | Buffer,
  header: string,
  secret: string,
  opts: VerifyOptions = {},
): void {
  if (header === '') throw new StripeSignatureError('missing stripe-signature header');
  const payloadStr = typeof payload === 'string' ? payload : payload.toString('utf8');
  const { timestamp, signatures } = parseHeader(header);
  if (timestamp === -1) throw new StripeSignatureError('no timestamp in signature header');
  if (signatures.length === 0) throw new StripeSignatureError('no v1 signature in header');

  const expected = Buffer.from(computeSignature(payloadStr, timestamp, secret), 'hex');
  const matched = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'hex');
    return sigBuf.length === expected.length && timingSafeEqual(sigBuf, expected);
  });
  if (!matched) throw new StripeSignatureError('no matching v1 signature');

  const tolerance = opts.toleranceSec ?? DEFAULT_SIGNATURE_TOLERANCE_SEC;
  if (tolerance > 0) {
    const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
    if (Math.abs(nowSec - timestamp) > tolerance) {
      throw new StripeSignatureError('timestamp outside tolerance window');
    }
  }
}

/**
 * Build a valid Stripe-Signature header for a payload — used by tests and the mock Stripe client
 * to construct signed webhook deliveries without the SDK or network.
 */
export function signStripePayload(
  payload: string | Buffer,
  secret: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
): string {
  const payloadStr = typeof payload === 'string' ? payload : payload.toString('utf8');
  return `t=${timestampSec},${SCHEME}=${computeSignature(payloadStr, timestampSec, secret)}`;
}
