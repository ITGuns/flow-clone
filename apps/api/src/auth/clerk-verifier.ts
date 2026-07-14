// Real Clerk session-token verifier — the production {@link ClerkVerifier}. Wraps @clerk/backend's
// networkless `verifyToken` (the token signature is checked against Clerk's JWKS, which the SDK
// fetches once and caches). NEVER exercised in unit tests — tests inject a fake ClerkVerifier — so
// no live Clerk keys are ever required to run the suite (ARCHITECTURE §5).
//
// Email sourcing: Clerk's default session token does NOT carry the user's email. This verifier
// reads a custom `email` claim, which the deployment MUST expose by adding
// `{"email": "{{user.primary_email_address}}"}` to the Clerk session-token template. This keeps
// verification a single networkless step (no extra users.getUser round-trip in the auth hot path).
// See the report's "unsure / contract friction" notes.
import { verifyToken } from '@clerk/backend';
import type { ClerkPrincipal, ClerkVerifier } from './ports';

export interface ClerkBackendVerifierOptions {
  /** Clerk secret key (Env.clerkSecretKey, §10). */
  secretKey: string;
  /** Optional `azp` allow-list (Clerk best practice against token replay across origins). */
  authorizedParties?: string[];
}

export class ClerkBackendVerifier implements ClerkVerifier {
  private readonly secretKey: string;
  private readonly authorizedParties: string[] | undefined;

  constructor(options: ClerkBackendVerifierOptions) {
    this.secretKey = options.secretKey;
    this.authorizedParties = options.authorizedParties;
  }

  async verify(token: string): Promise<ClerkPrincipal> {
    const claims = await verifyToken(token, {
      secretKey: this.secretKey,
      ...(this.authorizedParties !== undefined
        ? { authorizedParties: this.authorizedParties }
        : {}),
    });

    const clerkId = claims.sub;
    const email = readEmailClaim(claims);
    if (email === undefined) {
      throw new Error(
        'Clerk session token is missing the `email` claim. Add ' +
          '{"email": "{{user.primary_email_address}}"} to the Clerk session-token template ' +
          '(see apps/api/src/auth/clerk-verifier.ts).',
      );
    }
    return { clerkId, email };
  }
}

/** Read a non-empty string `email` custom claim without widening the payload type to `any`. */
function readEmailClaim(claims: object): string | undefined {
  const value = (claims as Record<string, unknown>).email;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
