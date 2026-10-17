import type { DB } from '@ethos/db';
import type { AuthHost } from '../auth/auth-host.ts';
import type { Auth } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import type { Loaders } from '../graphql/loaders.ts';

/** What `Context.ip` holds when the socket reports no address. One shared budget, not none. */
export const UNKNOWN_IP = 'unknown';

/**
 * What every resolver — generated or hand-written — is handed. `userId` is the
 * only thing that says who the caller is: it comes from the request's session
 * and nothing downstream may take it from an argument.
 */
export interface Context {
  db: DB;
  /** The better-auth instance for this request; the auth resolvers call `auth.api.*`. */
  auth: Auth;
  /** Where `auth` came from. Pairing a provider rebuilds it, so later requests get the new one. */
  authHost: AuthHost;
  userId: string | null;
  /** The request's headers. Signing out reads the session from them. */
  headers: Headers;
  /** The client's address as Express resolved it under `TRUST_PROXY`. `UNKNOWN_IP` when there is none. */
  ip: string;
  /** Sign-in throttle; the auth mutations call it. */
  limiter: RateLimiter;
  loaders: Loaders;
}
