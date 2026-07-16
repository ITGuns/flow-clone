// Dictionary REST routes — CONTRACTS §5 (`/v1/dictionary`). Thin transport layer over
// DictionaryStore: authenticate → delegate → translate DictionaryError to the §5 status.
//
// Auth: Clerk bearer in production (§5 header). Wired behind the shared `Authenticator` port
// (routes/session-token.ts) so this module is testable keyless with a fake principal; the real
// Clerk authenticator (Task 3a) swaps in at the same seam at the gate. On auth failure every route
// replies 401 with the WS-style error frame shape (consistent with POST /v1/session/token).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UndertoneError, toErrorMessage } from '@undertone/shared';
import type { DictionaryStore } from '../dictionary/store';
import { DictionaryError } from '../dictionary/store';
import type { AuthedUser, Authenticator } from './session-token';

/** Dependencies for the dictionary routes. `authenticator` is the Clerk-bearer seam (§5). */
export interface DictionaryRoutesDeps {
  store: DictionaryStore;
  authenticator: Authenticator;
}

interface IdParams {
  id: string;
}

/** Resolve the principal or send 401 (same shape as the session-token route). Returns undefined on 401. */
async function authOr401(
  authenticator: Authenticator,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthedUser | undefined> {
  try {
    return await authenticator.authenticate(req);
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
    return undefined;
  }
}

/** Translate a thrown DictionaryError into its §5 HTTP status; rethrow anything else (→ 500). */
function sendDictionaryError(err: unknown, reply: FastifyReply): void {
  if (err instanceof DictionaryError) {
    void reply.status(err.httpStatus).send({ error: err.errorCode, message: err.message });
    return;
  }
  throw err;
}

/**
 * Register the §5 dictionary CRUD routes on `app`. All routes require auth; bodies and ids are
 * validated inside the store (single source of the 400/404/409/422 contract).
 */
export function registerDictionaryRoutes(app: FastifyInstance, deps: DictionaryRoutesDeps): void {
  const { store, authenticator } = deps;

  // GET /v1/dictionary → { entries: DictionaryEntry[] }
  app.get('/v1/dictionary', async (req, reply) => {
    const user = await authOr401(authenticator, req, reply);
    if (!user) return;
    const entries = await store.list(user.userId);
    void reply.status(200).send({ entries });
  });

  // POST /v1/dictionary → DictionaryEntry (201)
  app.post('/v1/dictionary', async (req, reply) => {
    const user = await authOr401(authenticator, req, reply);
    if (!user) return;
    try {
      const entry = await store.create(user.userId, req.body);
      void reply.status(201).send(entry);
    } catch (err) {
      sendDictionaryError(err, reply);
    }
  });

  // PATCH /v1/dictionary/:id → DictionaryEntry (200)
  app.patch<{ Params: IdParams }>('/v1/dictionary/:id', async (req, reply) => {
    const user = await authOr401(authenticator, req, reply);
    if (!user) return;
    try {
      const entry = await store.update(user.userId, req.params.id, req.body);
      void reply.status(200).send(entry);
    } catch (err) {
      sendDictionaryError(err, reply);
    }
  });

  // DELETE /v1/dictionary/:id → { ok: true }
  app.delete<{ Params: IdParams }>('/v1/dictionary/:id', async (req, reply) => {
    const user = await authOr401(authenticator, req, reply);
    if (!user) return;
    try {
      await store.delete(user.userId, req.params.id);
      void reply.status(200).send({ ok: true });
    } catch (err) {
      sendDictionaryError(err, reply);
    }
  });
}
