// History REST routes — CONTRACTS.md §5:
//   GET    /v1/history?q=&cursor=&limit=  → { items: HistoryItem[], nextCursor? }
//   DELETE /v1/history/:id                → { ok: true }         (404 if not the owner's)
//   DELETE /v1/history                    → { ok: true, deleted } (bulk)
//
// Auth: Clerk bearer (§5). The concrete Clerk authenticator lands in Task 3a; here we depend on
// the injected `Authenticator` port (the same seam POST /v1/session/token uses) so the routes are
// built and tested keyless with MockAuthenticator. On auth failure → 401.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HistoryItem } from '@undertone/shared';
import { UndertoneError, toErrorMessage } from '@undertone/shared';
import type { Authenticator } from './session-token';
import type { TranscriptStore } from '../history/store';

/** Dependencies for the history routes: the store plus the (injected) REST authenticator. */
export interface HistoryRouteDeps {
  store: TranscriptStore;
  authenticator: Authenticator;
}

interface HistoryQuery {
  q?: string;
  cursor?: string;
  limit?: string;
}

interface ListResponse {
  items: HistoryItem[];
  nextCursor?: string;
}

/** Send the §8 `AUTH_INVALID` error frame with HTTP 401. */
function unauthorized(reply: FastifyReply, err: unknown): void {
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
}

/** Parse the `limit` query param (string | undefined) into a number the store can clamp. */
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Register the §5 history routes on `app`. Reads only from the injected deps; never touches
 * process.env. Owner scoping and decryption happen inside the store.
 */
export function registerHistoryRoutes(app: FastifyInstance, deps: HistoryRouteDeps): void {
  app.get(
    '/v1/history',
    async (req: FastifyRequest, reply: FastifyReply): Promise<ListResponse | void> => {
      let userId: string;
      try {
        userId = (await deps.authenticator.authenticate(req)).userId;
      } catch (err) {
        unauthorized(reply, err);
        return;
      }
      const query = req.query as HistoryQuery;
      const page = await deps.store.list({
        userId,
        q: query.q,
        cursor: query.cursor,
        limit: parseLimit(query.limit),
      });
      // Omit nextCursor entirely when absent (optional field, §5).
      return page.nextCursor === undefined
        ? { items: page.items }
        : { items: page.items, nextCursor: page.nextCursor };
    },
  );

  app.delete(
    '/v1/history/:id',
    async (req: FastifyRequest, reply: FastifyReply): Promise<{ ok: true } | void> => {
      let userId: string;
      try {
        userId = (await deps.authenticator.authenticate(req)).userId;
      } catch (err) {
        unauthorized(reply, err);
        return;
      }
      const { id } = req.params as { id: string };
      const deleted = await deps.store.delete(userId, id);
      if (!deleted) {
        void reply.status(404).send({
          t: 'error',
          code: 'INTERNAL',
          message: 'transcript not found',
          retryable: false,
        });
        return;
      }
      return { ok: true };
    },
  );

  app.delete(
    '/v1/history',
    async (
      req: FastifyRequest,
      reply: FastifyReply,
    ): Promise<{ ok: true; deleted: number } | void> => {
      let userId: string;
      try {
        userId = (await deps.authenticator.authenticate(req)).userId;
      } catch (err) {
        unauthorized(reply, err);
        return;
      }
      const deleted = await deps.store.deleteAll(userId);
      return { ok: true, deleted };
    },
  );
}
