import type { DB } from '@ethos/db';
import { accounts, sessions, users, verifications } from '@ethos/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink } from 'better-auth/plugins';
import { appUrl, authSecret, smtpConfigured } from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { SECONDS_PER_DAY, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { sendMagicLinkEmail } from './email.ts';

/** better-auth's id for the magic-link plugin. */
const MAGIC_LINK_PLUGIN_ID = 'magic-link';

/** What delivering one sign-in link is given. */
export interface MagicLink {
  email: string;
  /** The link to the app, with the token in its query. */
  url: string;
  token: string;
}

/** Overrides for tests. Production uses the defaults. */
export interface AuthOptions {
  /** What better-auth signs with. The default is `authSecret()`. */
  secret?: string;
  /**
   * Delivers a sign-in link; tests pass a fake that captures it. The default is
   * `sendMagicLinkEmail` when SMTP is configured, and no links at all otherwise.
   */
  sendMagicLink?: (link: MagicLink) => Promise<void>;
}

/**
 * Builds the better-auth instance. Server code calls `auth.api.*`, and none of its REST routes are mounted.
 *
 * @param db - The database sessions and pending links are kept in.
 * @param [options] - Test overrides.
 * @returns The auth instance.
 */
export function createAuth(db: DB, { secret = authSecret(), sendMagicLink }: AuthOptions = {}) {
  const smtpDelivery = smtpConfigured() ? sendMagicLinkEmail : undefined;
  const deliver = sendMagicLink ?? smtpDelivery;
  const magicLinkPlugins =
    deliver === undefined
      ? []
      : [
          magicLink({
            // better-auth takes seconds.
            expiresIn: AUTH_DEFAULTS.magicLinkTtlMinutes * SECONDS_PER_MINUTE,
            storeToken: 'hashed',
            // Links go to the app, which calls verifyMagicLink. The REST verify route is not mounted.
            sendMagicLink: ({ email, token }) =>
              deliver({ email, token, url: `${appUrl()}/auth/verify?token=${encodeURIComponent(token)}` }),
          }),
        ];

  return betterAuth({
    // The rc drizzle instance is keyed by relations, so the adapter cannot discover tables itself.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secret,
    baseURL: appUrl(),
    advanced: { database: { generateId: 'uuid' } },
    session: { expiresIn: AUTH_DEFAULTS.sessionTtlDays * SECONDS_PER_DAY },
    // bearer: mutations return the raw token, and the client sends it back as `Authorization: Bearer`.
    plugins: [bearer(), ...magicLinkPlugins],
  });
}

/** The better-auth instance `createAuth` builds. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * Whether this instance emails sign-in links.
 *
 * @param auth - The auth instance.
 * @returns true when it was built with a way to deliver them.
 */
export function sendsMagicLinks(auth: Auth): boolean {
  return auth.options.plugins.some((plugin) => plugin.id === MAGIC_LINK_PLUGIN_ID);
}

/**
 * Reads who a request's session belongs to.
 *
 * @param auth - The auth instance.
 * @param headers - The request's headers, carrying `Authorization: Bearer`.
 * @returns The user's id, or null when there is no live session.
 */
export async function sessionUserId(auth: Auth, headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user.id ?? null;
}
