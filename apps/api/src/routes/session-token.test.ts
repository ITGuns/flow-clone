import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { UndertoneError } from '@undertone/shared';
import { buildServer } from '../index';
import { loadEnv } from '../env';
import {
  verifySessionToken,
  TokenExpiredError,
  TokenInvalidError,
  signSessionToken,
  MOCK_JWT_SECRET,
} from '../ws/jwt';
import {
  MockAuthenticator,
  registerSessionTokenRoute,
  type Authenticator,
  type SessionTokenResponse,
} from './session-token';
import Fastify from 'fastify';

const MOCK = loadEnv({ MOCK_MODE: '1' });

describe('POST /v1/session/token', () => {
  it('mints a verifiable HS256 token for the mock user (user_mock, pro)', async () => {
    const app = buildServer(MOCK);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/v1/session/token' });
    expect(res.statusCode).toBe(200);
    const body = res.json<SessionTokenResponse>();
    expect(typeof body.token).toBe('string');
    expect(typeof body.expiresAt).toBe('string');

    const claims = await verifySessionToken(body.token);
    expect(claims.sub).toBe('user_mock');
    expect(claims.plan).toBe('pro');
    expect(typeof claims.jti).toBe('string');
    await app.close();
  });

  it('returns 401 when the authenticator rejects', async () => {
    const rejecting: Authenticator = {
      authenticate: (_req: FastifyRequest) => Promise.reject(new UndertoneError('AUTH_INVALID')),
    };
    const app = Fastify({ logger: false });
    registerSessionTokenRoute(app, rejecting);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/v1/session/token' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('AUTH_INVALID');
    await app.close();
  });
});

describe('session JWT helpers', () => {
  it('round-trips claims', async () => {
    const { token } = await signSessionToken({ sub: 'u1', plan: 'free', jti: 'j1' });
    const claims = await verifySessionToken(token);
    expect(claims).toEqual({ sub: 'u1', plan: 'free', jti: 'j1' });
  });

  it('rejects an expired token with TokenExpiredError', async () => {
    // Issued 2 minutes ago with a 60s TTL → already expired.
    const { token } = await signSessionToken(
      { sub: 'u1', plan: 'pro', jti: 'j1' },
      MOCK_JWT_SECRET,
      Date.now() - 120_000,
    );
    await expect(verifySessionToken(token)).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('rejects a garbage token with TokenInvalidError', async () => {
    await expect(verifySessionToken('not.a.jwt')).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('binds signature to the injected secret (§10 plumbing)', async () => {
    // A token signed with one Env secret must verify under that secret and no other.
    const { token } = await signSessionToken({ sub: 'u1', plan: 'pro', jti: 'j1' }, 'secret-A');
    await expect(verifySessionToken(token, 'secret-A')).resolves.toMatchObject({ sub: 'u1' });
    await expect(verifySessionToken(token, 'secret-B')).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('MockAuthenticator resolves the fixed principal', async () => {
    const user = await new MockAuthenticator().authenticate({} as FastifyRequest);
    expect(user).toEqual({ userId: 'user_mock', plan: 'pro' });
  });
});
