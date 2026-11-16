import type { DB } from '@ethos/db';
import { Credential } from '../core/context.ts';
import { API_KEY_HEADER, type Auth, apiKeyUserId, sessionUserId } from './better-auth.ts';
import { looksLikeJwt, type ProviderTokens, userForSubject } from './provider-tokens.ts';

// Who a request is. graphql/handler.ts `createContextFactory` is the one place
// this is asked, for /graphql and /mcp alike.

/** The scheme a session token or a provider access token is sent under. Case-sensitive, as the client sends it. */
const BEARER_PREFIX = 'Bearer ';

/** Who a request is, and what it proved it with. Both are null for nobody. */
export interface Caller {
  userId: string | null;
  credential: Credential | null;
}

/** A request that carries no credential, or one that does not hold. */
const ANONYMOUS: Caller = { userId: null, credential: null };

/** What reading a caller needs beyond the headers. */
export interface CallerSources {
  /** The auth instance for this request, which knows sessions and keys. */
  auth: Auth;
  /** Where a provider access token's `sub` is looked up. */
  db: DB;
  /** The OIDC provider's access-token verifier (auth-host.ts), or null with no provider: then no JWT is anyone. */
  providerTokens: ProviderTokens | null;
}

/**
 * Reads who a request is. The first credential the request carries decides, and one that does not hold is nobody,
 * never a fall through to the next:
 *
 * 1. `x-api-key`: another program, acting as the key's owner. A revoked or expired key is nobody even beside a live
 *    session or token, so the program hears UNAUTHENTICATED rather than acting as whoever else the headers name.
 * 2. `Authorization: Bearer <JWT>`: an access token the OIDC provider issued for this API, while there is a provider,
 *    mapped to the account that signed in through it with the token's `sub`. A session token has no dots, so a JWT
 *    never costs a session lookup.
 * 3. `Authorization: Bearer <session>`: a person, on a better-auth session.
 *
 * @param sources - The auth instance, the database and the provider's verifier.
 * @param headers - The request's headers.
 * @returns The caller, or nobody.
 */
export async function readCaller({ auth, db, providerTokens }: CallerSources, headers: Headers): Promise<Caller> {
  const key = headers.get(API_KEY_HEADER);
  if (key !== null) {
    const userId = await apiKeyUserId(auth, key);
    return userId === null ? ANONYMOUS : { userId, credential: Credential.ApiKey };
  }
  const bearer = bearerOf(headers);
  if (bearer !== null && looksLikeJwt(bearer)) {
    return readProviderToken(db, bearer, providerTokens);
  }
  const userId = await sessionUserId(auth, headers);
  return userId === null ? ANONYMOUS : { userId, credential: Credential.Session };
}

/**
 * Reads the token a request sends as `Authorization: Bearer`.
 *
 * @param headers - The request's headers.
 * @returns The token, or null when there is none.
 */
function bearerOf(headers: Headers): string | null {
  const authorization = headers.get('authorization') ?? '';
  const hasBearer = authorization.startsWith(BEARER_PREFIX);
  return hasBearer ? authorization.slice(BEARER_PREFIX.length).trim() : null;
}

/**
 * Reads the person a provider access token is for: verified, then mapped through the `accounts` row their browser
 * sign-in left, never by email.
 *
 * @param db - The database.
 * @param token - The bearer.
 * @param tokens - The provider's verifier, or null with no provider.
 * @returns The caller, or nobody.
 */
async function readProviderToken(db: DB, token: string, tokens: ProviderTokens | null): Promise<Caller> {
  if (tokens === null) {
    return ANONYMOUS;
  }
  const verified = await tokens.verify(token);
  if (verified === null) {
    return ANONYMOUS;
  }
  const userId = await userForSubject(db, verified.sub);
  return userId === null ? ANONYMOUS : { userId, credential: Credential.ProviderToken };
}
