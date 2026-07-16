// Session-token JWT — CONTRACTS.md §4.1 / §5. HS256, 60s expiry, claims { sub, plan, jti }.
//
// The signing/verifying secret is INJECTED (plumbed from the typed Env's `sessionJwtSecret`,
// CONTRACTS §10) — this module never reads `process.env`. The `MOCK_JWT_SECRET` default keeps
// direct callers (tests, the keyless build) green; it matches the mock-mode default in env.ts,
// so a token signed with the default verifies against a gateway wired from the mock Env.
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Plan } from '../routes/session-token';

/** Token lifetime — CONTRACTS.md §4.1 ("HS256, 60s expiry"). */
export const SESSION_TOKEN_TTL_SEC = 60;

/**
 * Dev/mock fallback secret. Mirrors env.ts' mock-mode `sessionJwtSecret` so a default-signed
 * token verifies against a mock-Env-wired gateway. Never used in real mode — the composition
 * root plumbs the real secret from Env into both the token route and the gateway.
 */
export const MOCK_JWT_SECRET = 'mock-secret-do-not-ship';

/** The signed claim set — CONTRACTS.md §4.1 (`{ sub: userId, plan, jti }`). */
export interface SessionClaims {
  sub: string;
  plan: Plan;
  jti: string;
}

/** Encode an HS256 secret string into the key bytes jose expects. */
function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface SignedToken {
  token: string;
  /** Absolute expiry as ISO 8601 — mirrors the REST `expiresAt` field (§5). */
  expiresAt: string;
}

/**
 * Mint a session token signed with `secret` (plumbed from Env.sessionJwtSecret). `nowMs` is
 * injectable for deterministic tests; `secret` defaults to the mock secret for keyless callers.
 */
export async function signSessionToken(
  claims: SessionClaims,
  secret: string = MOCK_JWT_SECRET,
  nowMs: number = Date.now(),
): Promise<SignedToken> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TOKEN_TTL_SEC;
  const token = await new SignJWT({ plan: claims.plan, jti: claims.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secretKey(secret));
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Distinguishes an expired token (→ AUTH_EXPIRED) from any other failure (→ AUTH_INVALID). */
export class TokenExpiredError extends Error {
  constructor() {
    super('session token expired');
    this.name = 'TokenExpiredError';
  }
}
export class TokenInvalidError extends Error {
  constructor(message = 'session token invalid') {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

/**
 * Verify a session token against `secret` (plumbed from Env.sessionJwtSecret) and extract its
 * claims. Throws {@link TokenExpiredError} on expiry and {@link TokenInvalidError} on any other
 * failure (bad signature, malformed, missing claims). `secret` defaults to the mock secret.
 */
export async function verifySessionToken(
  token: string,
  secret: string = MOCK_JWT_SECRET,
): Promise<SessionClaims> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, secretKey(secret), { algorithms: ['HS256'] });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new TokenExpiredError();
    throw new TokenInvalidError(err instanceof Error ? err.message : 'verify failed');
  }
  const sub = payload.sub;
  const plan = payload.plan;
  const jti = payload.jti;
  if (typeof sub !== 'string' || (plan !== 'free' && plan !== 'pro') || typeof jti !== 'string') {
    throw new TokenInvalidError('token missing required claims');
  }
  return { sub, plan, jti };
}
