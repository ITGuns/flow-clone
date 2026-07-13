// POST /v1/session/token — CONTRACTS.md §5. Clerk-authenticated in production (Phase 3);
// abstracted here behind an `Authenticator` so the WS gateway can be built and tested keyless.
//
// In MOCK_MODE the route authenticates every request as a fixed mock user (`user_mock`, plan
// 'pro') and mints an HS256 session JWT (§4.1). The Clerk-backed authenticator lands in Phase 3
// and swaps in behind the same interface.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UndertoneError, toErrorMessage } from '@undertone/shared';
import { signSessionToken } from '../ws/jwt';

export type Plan = 'free' | 'pro';

/** The authenticated principal a token is minted for. */
export interface AuthedUser {
  userId: string;
  plan: Plan;
}

/**
 * Resolves the caller's identity for `POST /v1/session/token`. Production impl validates a Clerk
 * bearer (Phase 3); MOCK_MODE impl returns a fixed principal. Rejects with
 * `UndertoneError('AUTH_INVALID')` when the caller is not authenticated.
 */
export interface Authenticator {
  authenticate(req: FastifyRequest): Promise<AuthedUser>;
}

/** MOCK_MODE authenticator — every request is the fixed mock user (§5, ARCHITECTURE §5). */
export class MockAuthenticator implements Authenticator {
  constructor(private readonly user: AuthedUser = { userId: 'user_mock', plan: 'pro' }) {}
  authenticate(_req: FastifyRequest): Promise<AuthedUser> {
    return Promise.resolve(this.user);
  }
}

export interface SessionTokenResponse {
  token: string;
  expiresAt: string;
}

/** Register `POST /v1/session/token`. 200 → `{ token, expiresAt }`; 401 on auth failure (§5). */
export function registerSessionTokenRoute(
  app: FastifyInstance,
  authenticator: Authenticator,
): void {
  app.post(
    '/v1/session/token',
    async (req: FastifyRequest, reply: FastifyReply): Promise<SessionTokenResponse | void> => {
      let user: AuthedUser;
      try {
        user = await authenticator.authenticate(req);
      } catch (err) {
        const wire =
          err instanceof UndertoneError
            ? toErrorMessage(err)
            : {
                t: 'error' as const,
                code: 'AUTH_INVALID' as const,
                message: 'unauthenticated',
                retryable: false,
              };
        void reply.status(401).send(wire);
        return;
      }
      const { token, expiresAt } = await signSessionToken({
        sub: user.userId,
        plan: user.plan,
        jti: randomUUID(),
      });
      return { token, expiresAt };
    },
  );
}
