import type { DB } from '@ethos/db';
import { accounts, sessions, users, verifications } from '@ethos/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth, magicLink, oneTimeToken } from 'better-auth/plugins';
import {
  appUrl,
  authSecret,
  OIDC_PROVIDER_ID,
  type OidcConfig,
  oidcConfig,
  serverUrl,
  smtpConfigured,
} from '../core/config.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { SECONDS_PER_DAY, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { claimFirstAdmin } from './admin.ts';
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
  /** The OIDC provider to sign in with, or null for none. The default is `oidcConfig()`, the environment's. */
  oidc?: OidcConfig | null;
}

/**
 * Builds the better-auth instance. Server code calls `auth.api.*`, and none of its REST routes are mounted.
 *
 * @param db - The database sessions and pending links are kept in.
 * @param [options] - Test overrides.
 * @returns The auth instance.
 */
export function createAuth(db: DB, { secret = authSecret(), sendMagicLink, oidc = oidcConfig() }: AuthOptions = {}) {
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
    // The OIDC callback is served here (http/sso.ts), which in development is not the app's origin.
    baseURL: serverUrl(),
    // So a sign-in may finish on the app's pages when they are another origin.
    trustedOrigins: [new URL(appUrl()).origin],
    advanced: { database: { generateId: 'uuid' } },
    session: { expiresIn: AUTH_DEFAULTS.sessionTtlDays * SECONDS_PER_DAY },
    // Every way an account is made (a link, SECURE_LOCAL_NET, OIDC) goes through
    // better-auth's adapter, so this is the one place the first one becomes the admin.
    databaseHooks: { user: { create: { after: async (user) => claimFirstAdmin(db, user.id) } } },
    // An address the operator's own provider vouches for signs in to the account
    // that has it, even one Ethos never checked itself (made under SECURE_LOCAL_NET).
    ...(oidc ? { account: { accountLinking: { requireLocalEmailVerified: false } } } : {}),
    // Where an OIDC callback goes when it cannot tell where the sign-in came from:
    // the login page, which says so, rather than better-auth's own error page.
    onAPIError: { errorURL: `${appUrl()}/login` },
    plugins: [
      // bearer: mutations return the raw token, and the client sends it back as `Authorization: Bearer`.
      bearer(),
      // How an OIDC sign-in reaches the app: the callback mints one of these, and
      // /auth/sso spends it over GraphQL. The session never rides in a URL or a cookie.
      oneTimeToken({
        expiresIn: AUTH_DEFAULTS.oneTimeTokenTtlMinutes,
        storeToken: 'hashed',
        disableClientRequest: true,
        disableSetSessionCookie: true,
      }),
      ...(oidc ? [oidcPlugin(oidc)] : []),
      ...magicLinkPlugins,
    ],
  });
}

/** The better-auth instance `createAuth` builds. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * The OIDC provider, through better-auth's generic OAuth plugin. Endpoints, keys and issuer come
 * from the discovery document, the id token is checked against them, and better-auth's own sign-in
 * and callback endpoints run the flow (state, PKCE, nonce).
 *
 * @param oidc - The provider.
 * @returns The plugin.
 */
function oidcPlugin(oidc: OidcConfig) {
  return genericOAuth({
    config: [
      {
        providerId: OIDC_PROVIDER_ID,
        name: oidc.name,
        discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        requireIdTokenVerification: true,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        tokenEndpointAuth: { method: oidc.clientSecret ? oidc.clientAuth : 'none' },
        pkce: true,
        scopes: ['openid', 'profile', 'email'],
        // A provider may release only a username, or no name at all: fall back to the address's local part.
        mapProfileToUser: (profile) => ({
          name:
            stringClaim(profile.name) ??
            stringClaim(profile.preferred_username) ??
            stringClaim(profile.email)?.split('@')[0] ??
            '',
        }),
      },
    ],
  });
}

/**
 * Reads a claim that should be text.
 *
 * @param value - The claim as the provider sent it.
 * @returns The text, or undefined when it is missing, blank or not a string.
 */
function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

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
