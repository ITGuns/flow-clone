// Stripe HTTP routes — CONTRACTS §5.
//
//   registerStripeWebhookRoute → POST /v1/webhooks/stripe   (§5; NO bearer auth — the Stripe
//     signature is the auth; 400 on bad sig; 200 { received: true } otherwise).
//   registerBillingRoutes      → POST /v1/billing/checkout  (ADDITIVE — NOT in §5; flagged as
//     contract friction for the orchestrator to add to §5. Clerk-bearer-authenticated via the
//     same `Authenticator` port as /v1/session/token.)
//
// Raw-body handling: Stripe signs the exact request bytes, so the webhook route needs the
// unparsed body. This is achieved WITHOUT breaking JSON parsing elsewhere by registering a
// `parseAs: 'buffer'` content-type parser inside an ENCAPSULATED plugin scope (Fastify content-
// type parsers are scoped to the plugin they're registered in). The parent instance keeps its
// default JSON parser for every other route.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StripeSignatureError, type StripeService, type PlanInterval } from '../billing';
import type { Authenticator, AuthedUser } from './session-token';

export interface StripeWebhookDeps {
  service: StripeService;
}

/** Register `POST /v1/webhooks/stripe` with a scoped raw-body parser (§5). */
export function registerStripeWebhookRoute(app: FastifyInstance, deps: StripeWebhookDeps): void {
  // Encapsulated scope: the raw-buffer parser below does not leak to sibling routes.
  void app.register((scope, _opts, done) => {
    scope.addContentTypeParser<Buffer>(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, parserDone) => {
        parserDone(null, body);
      },
    );

    scope.post(
      '/v1/webhooks/stripe',
      async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const header = req.headers['stripe-signature'];
        const signature = typeof header === 'string' ? header : '';
        const body = req.body;
        const rawBody = Buffer.isBuffer(body)
          ? body
          : Buffer.from(typeof body === 'string' ? body : '');

        try {
          const result = await deps.service.handleSignedWebhook(rawBody, signature);
          void reply.status(200).send(result);
        } catch (err) {
          if (err instanceof StripeSignatureError) {
            void reply.status(400).send({ received: false, error: err.message });
            return;
          }
          throw err; // unexpected → global error handler (500)
        }
      },
    );
    done();
  });
}

/** Default post-checkout redirect targets (overridable per request). */
export const DEFAULT_CHECKOUT_SUCCESS_URL = 'https://app.undertone.example/billing/success';
export const DEFAULT_CHECKOUT_CANCEL_URL = 'https://app.undertone.example/billing/cancel';

export interface BillingRoutesDeps {
  service: StripeService;
  authenticator: Authenticator;
}

interface CheckoutBody {
  interval?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
}

function parseInterval(value: unknown): PlanInterval | undefined {
  if (value === 'monthly' || value === 'yearly') return value;
  return undefined;
}

/**
 * Register `POST /v1/billing/checkout` (ADDITIVE — not in §5). Body: `{ interval:
 * 'monthly'|'yearly', successUrl?, cancelUrl? }`; 200 → `{ url }`; 400 on a bad interval; 401 when
 * unauthenticated.
 */
export function registerBillingRoutes(app: FastifyInstance, deps: BillingRoutesDeps): void {
  app.post(
    '/v1/billing/checkout',
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      let user: AuthedUser;
      try {
        user = await deps.authenticator.authenticate(req);
      } catch {
        void reply
          .status(401)
          .send({ t: 'error', code: 'AUTH_INVALID', message: 'unauthenticated', retryable: false });
        return;
      }

      const body = (req.body ?? {}) as CheckoutBody;
      const interval = parseInterval(body.interval);
      if (!interval) {
        void reply.status(400).send({ error: 'interval must be "monthly" or "yearly"' });
        return;
      }

      const result = await deps.service.createCheckout({
        userId: user.userId,
        interval,
        successUrl:
          typeof body.successUrl === 'string' ? body.successUrl : DEFAULT_CHECKOUT_SUCCESS_URL,
        cancelUrl:
          typeof body.cancelUrl === 'string' ? body.cancelUrl : DEFAULT_CHECKOUT_CANCEL_URL,
      });
      void reply.status(200).send({ url: result.url });
    },
  );
}
