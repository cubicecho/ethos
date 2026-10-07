import type { DB } from '@ethos/db';
import type { RateLimiter } from '../auth/rate-limit.ts';
import type { Loaders } from '../graphql/loaders.ts';

/** What `Context.ip` holds when the socket reports no address. One shared budget, not none. */
export const UNKNOWN_IP = 'unknown';

/**
 * What every resolver — generated or hand-written — is handed. `userId` is the
 * only thing that says who the caller is: it comes from the request's Bearer
 * token and nothing downstream may take it from an argument.
 */
export interface Context {
  db: DB;
  userId: string | null;
  /** The client's address as Express resolved it under `TRUST_PROXY`. `UNKNOWN_IP` when there is none. */
  ip: string;
  /** Sign-in throttle; the auth mutations call it. */
  limiter: RateLimiter;
  loaders: Loaders;
}
