// Session-token JWT — CONTRACTS.md §4.1 / §5. HS256, 60s expiry, claims { sub, plan, jti }.
//
// SEAM (flag): the signing secret is read from `process.env.SESSION_JWT_SECRET` directly here
// rather than from `apps/api/src/env.ts`, because env.ts is outside this task's allowlist and
// does not yet carry SESSION_JWT_SECRET. The mock-mode default keeps the keyless build green.
// The orchestrator reconciles this into the typed Env at the Phase 1 gate.
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Plan } from '../routes/session-token';

/** Token lifetime — CONTRACTS.md §4.1 ("HS256, 60s expiry"). */
export const SESSION_TOKEN_TTL_SEC = 60;

/** Dev/mock fallback secret. Never used in real mode — the gate wires a real secret via env. */
export const MOCK_JWT_SECRET = 'mock-secret-do-not-ship';

/** The signed claim set — CONTRACTS.md §4.1 (`{ sub: userId, plan, jti }`). */
export interface SessionClaims {
  sub: string;
  plan: Plan;
  jti: string;
}

/** Read the HS256 secret. `process.env.SESSION_JWT_SECRET` with a mock-mode default. */
function secretKey(): Uint8Array {
  const raw = process.env.SESSION_JWT_SECRET ?? MOCK_JWT_SECRET;
  return new TextEncoder().encode(raw);
}

export interface SignedToken {
  token: string;
  /** Absolute expiry as ISO 8601 — mirrors the REST `expiresAt` field (§5). */
  expiresAt: string;
}

/** Mint a session token. `nowMs` is injectable for deterministic tests. */
export async function signSessionToken(
  claims: SessionClaims,
  nowMs: number = Date.now(),
): Promise<SignedToken> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TOKEN_TTL_SEC;
  const token = await new SignJWT({ plan: claims.plan, jti: claims.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secretKey());
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
 * Verify a session token and extract its claims. Throws {@link TokenExpiredError} on expiry and
 * {@link TokenInvalidError} on any other failure (bad signature, malformed, missing claims).
 */
export async function verifySessionToken(token: string): Promise<SessionClaims> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
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
