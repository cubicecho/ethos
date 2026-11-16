import type { DB } from '@ethos/db';
import * as dbSchema from '@ethos/db/schema';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from 'jose';
import { OIDC_PROVIDER_ID } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND } from '../core/wire.ts';

// Access tokens the OIDC provider issued for Ethos's API (RFC 9068), accepted as
// a bearer in place of a session. A device app such as Home Assistant runs the
// device flow (RFC 8628) at the provider, never in a browser here, and calls the
// API with the token it got back. The token is a person signing in, as a session
// is: it is mapped to the Ethos account that signed in through the same
// provider, and only through that account's `accounts` row. Never by email: an
// address is something the provider's other clients can claim too, and a `sub`
// is the one thing the provider vouches for.

/**
 * The signature algorithms a provider token may use: asymmetric ones only. `none` would be no signature, and an HS*
 * key would be a secret Ethos does not hold, so neither is ever accepted, whatever the provider advertises.
 */
export const PROVIDER_TOKEN_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'Ed25519',
] as const;

/** The `typ` header RFC 9068 gives a JWT access token. jose also accepts `application/at+jwt`. */
export const ACCESS_TOKEN_TYP = 'at+jwt';

/** What a provider that advertises no algorithm signs with: RS256 is the one OIDC makes every provider support. */
const FALLBACK_ALGORITHM = 'RS256';

/**
 * The claims a token must carry, beyond the issuer and audience checked by value. Not `scope` or `client_id`: heautou
 * leaves `scope` out for an API that defines none, and which of its clients asked does not change who the person is.
 */
const REQUIRED_CLAIMS = ['sub', 'exp'];

/** Three base64url parts, the last of which may be empty. A better-auth session token has no dots. */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/** What a provider's discovery document says that verifying a token needs. */
interface Discovery {
  /** The issuer exactly as the provider writes it, which is what its tokens' `iss` carry. */
  issuer: string;
  keys: ReturnType<typeof createRemoteJWKSet>;
  algorithms: string[];
}

/** A provider token that verified. */
export interface VerifiedProviderToken {
  /** The provider's id for the person. */
  sub: string;
  /** When the token stops being good. */
  expiresAt: Date;
}

/** Verifies access tokens from one provider, for one audience. */
export interface ProviderTokens {
  /** The issuer tokens must come from. */
  readonly issuer: string;
  /** The audience tokens must be issued for. */
  readonly audience: string;
  /**
   * Checks a token's signature, issuer, audience, `typ` and lifetime.
   *
   * @param token - The bearer, as sent.
   * @returns What it says, or null when it is not good for any reason.
   */
  verify(token: string): Promise<VerifiedProviderToken | null>;
}

/**
 * Whether a bearer has a JWT's shape. A better-auth session token has no dots, so this tells the two apart without a
 * lookup.
 *
 * @param token - The bearer.
 * @returns true for something that may be a JWT.
 */
export function looksLikeJwt(token: string): boolean {
  return JWT_SHAPE.test(token);
}

/**
 * Builds the verifier for one provider. Its discovery document and keys are fetched on the first token and kept, and
 * the keys are fetched again when a token names one they do not have, which is how a key rotation reaches here. The
 * auth host builds a new verifier whenever the provider changes, so nothing from the last one is trusted.
 *
 * @param issuer - The provider in effect (sso/settings.ts `effectiveOidc`).
 * @param audience - Ethos's API audience (config.ts `oidcApiAudience`).
 * @returns The verifier.
 */
export function createProviderTokens(issuer: string, audience: string): ProviderTokens {
  let discovery: Promise<Discovery> | undefined;
  const discovered = (): Promise<Discovery> => {
    discovery ??= discover(issuer).catch((error: unknown) => {
      // Not kept: a provider that was down a moment ago may be up for the next token.
      discovery = undefined;
      throw error;
    });
    return discovery;
  };

  return {
    issuer,
    audience,
    async verify(token) {
      let found: Discovery;
      try {
        found = await discovered();
      } catch (error) {
        console.warn(
          `[auth] cannot read ${issuer}'s discovery document, so its access tokens are refused:`,
          errorMessage(error),
        );
        return null;
      }
      try {
        const { payload } = await jwtVerify(token, found.keys, {
          issuer: found.issuer,
          audience,
          typ: ACCESS_TOKEN_TYP,
          algorithms: found.algorithms,
          clockTolerance: AUTH_DEFAULTS.providerTokenClockToleranceSeconds,
          requiredClaims: REQUIRED_CLAIMS,
        });
        return verified(payload);
      } catch (error) {
        // A token that fails a check is a refusal, not a fault, so it is not logged. Keys that could not be fetched are.
        const isRefusal = error instanceof errors.JOSEError && error instanceof errors.JWKSTimeout === false;
        if (isRefusal === false) {
          console.warn(`[auth] could not check an access token from ${issuer}:`, errorMessage(error));
        }
        return null;
      }
    },
  };
}

/**
 * Reads the provider's discovery document: where its keys are, and which algorithms it signs with, narrowed to
 * `PROVIDER_TOKEN_ALGORITHMS`.
 *
 * @param issuer - The issuer, as configured.
 * @returns What verifying needs.
 * @throws When the document cannot be read, names another issuer, or names no keys.
 */
async function discover(issuer: string): Promise<Discovery> {
  const timeout = AUTH_DEFAULTS.providerTokenFetchTimeoutMs;
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (response.ok === false) {
    throw new Error(`discovery answered ${response.status}`);
  }
  const document = (await response.json()) as Record<string, unknown>;
  const named = typeof document.issuer === 'string' ? document.issuer : '';
  // A document naming another issuer would hand over someone else's keys.
  if (named.replace(/\/+$/, '') !== issuer.replace(/\/+$/, '')) {
    throw new Error(`discovery names another issuer (${named || 'none'})`);
  }
  const jwksUri = typeof document.jwks_uri === 'string' ? document.jwks_uri : '';
  if (URL.canParse(jwksUri) === false) {
    throw new Error('discovery has no jwks_uri');
  }
  const allowed: readonly string[] = PROVIDER_TOKEN_ALGORITHMS;
  const advertised = Array.isArray(document.id_token_signing_alg_values_supported)
    ? document.id_token_signing_alg_values_supported.filter((alg): alg is string => typeof alg === 'string')
    : [];
  const algorithms = advertised.filter((alg) => allowed.includes(alg));
  return {
    issuer: named,
    keys: createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: timeout }),
    algorithms: algorithms.length > 0 ? algorithms : [FALLBACK_ALGORITHM],
  };
}

/**
 * Reads the claims Ethos uses off a verified token.
 *
 * @param payload - The verified claims.
 * @returns The subject and expiry, or null when either is missing.
 */
function verified(payload: JWTPayload): VerifiedProviderToken | null {
  if (typeof payload.sub !== 'string' || payload.sub === '' || typeof payload.exp !== 'number') {
    return null;
  }
  return { sub: payload.sub, expiresAt: new Date(payload.exp * MS_PER_SECOND) };
}

/**
 * Finds the Ethos account a provider's `sub` signed in as: the one whose `accounts` row for the OIDC provider has it.
 * A person who has never signed in to Ethos through the provider has none, and must once, in a browser, first.
 *
 * @param db - The database.
 * @param sub - The provider's id for the person.
 * @returns The user's id, or null.
 */
export async function userForSubject(db: DB, sub: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: dbSchema.users.id })
    .from(dbSchema.accounts)
    .innerJoin(dbSchema.users, eq(dbSchema.users.id, dbSchema.accounts.userId))
    .where(and(eq(dbSchema.accounts.providerId, OIDC_PROVIDER_ID), eq(dbSchema.accounts.accountId, sub)))
    .limit(1);
  return row?.userId ?? null;
}
