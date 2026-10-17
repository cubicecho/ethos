import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { secureLocalNet, serverUrl } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { badInput, unauthenticated } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { SSO_START_PATH } from '../http/sso.ts';
import { effectiveOidc } from '../sso/settings.ts';
import { sendsMagicLinks, sessionUserId } from './better-auth.ts';
import { AuthFlow, throttle } from './throttle.ts';

/** How an account made by a SECURE_LOCAL_NET sign-in is labelled in better-auth's hooks. */
const LOCAL_NET_METHOD = 'secure-local-net';

/** What a link that cannot be spent is told, whichever way it is wrong. */
const BAD_LINK = 'Invalid or expired sign-in link.';

/** What a one-time token that cannot be spent is told: the sign-in has to be started again. */
const BAD_SSO_TOKEN = 'Invalid or expired sign-in. Sign in again.';

const AUTH_SDL = parse(`
  """Which ways of signing in this instance offers, so the sign-in page shows only those."""
  type AuthConfig {
    """Any email address signs in at once, with no link. Private networks only."""
    secureLocalNet: Boolean!
    """The instance can email sign-in links."""
    magicLink: Boolean!
    """The OIDC provider to sign in with (OIDC_ISSUER, or the paired one), or null when there is none."""
    sso: SsoProvider
  }

  """An OpenID Connect provider the sign-in page offers."""
  type SsoProvider {
    """What the button calls it (OIDC_NAME, or the name in the setup URL)."""
    name: String!
    """Where the button sends the browser. Absolute: in development the server is not the app's origin."""
    signInUrl: String!
  }

  type AuthSession {
    """Sent back as \`Authorization: Bearer\`."""
    token: String!
    userId: ID!
  }

  type SignInResult {
    """A sign-in link was emailed."""
    sent: Boolean!
    """Set when the instance signs the caller in at once."""
    session: AuthSession
  }

  extend type Query {
    authConfig: AuthConfig!
  }

  extend type Mutation {
    requestSignIn(email: String!): SignInResult!
    verifyMagicLink(token: String!): AuthSession!
    """The last leg of an OIDC sign-in: the one-time token the callback put on /auth/sso, for a session."""
    verifyOneTimeToken(token: String!): AuthSession!
    signOut: Boolean!
  }
`);

const emailInput = z.email('Enter a valid email address.');

/**
 * The caller's user id, or a thrown UNAUTHENTICATED.
 *
 * @param context - The request context.
 * @returns The signed-in user's id.
 */
export function requireAuth(context: Context): string {
  if (!context.userId) {
    throw unauthenticated('Unauthenticated');
  }
  return context.userId;
}

/**
 * An address as it is stored and compared: lowercased and trimmed.
 *
 * @param email - The address as typed.
 * @returns The normalized address.
 */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * What a new account is called until its owner says otherwise.
 *
 * @param email - The account's address, already normalized.
 * @returns The part of the address before the `@`.
 */
function nameFor(email: string): string {
  return email.split('@')[0] ?? email;
}

/**
 * Signs an address in on the strength of the network alone, creating the account when there is none.
 *
 * Registration is open either way: self-hosting is the deployment model, so
 * whoever can reach the instance is who is meant to have an account.
 *
 * @param context - The request context.
 * @param email - The address, already normalized.
 * @returns The session, as `AuthSession` serves it.
 */
async function signInOnLocalNet(context: Context, email: string): Promise<{ token: string; userId: string }> {
  const { internalAdapter } = await context.auth.$context;
  const existing = await internalAdapter.findUserByEmail(email);
  const user =
    existing?.user ??
    (await internalAdapter.createUser(
      { email, name: nameFor(email), emailVerified: false },
      { method: LOCAL_NET_METHOD },
    ));
  const session = await internalAdapter.createSession(user.id);
  return { token: session.token, userId: user.id };
}

/**
 * Adds signing in, signing out and `authConfig` to the generated schema.
 *
 * @param schema - The generated schema.
 * @returns The schema with the auth fields on it.
 */
export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const queries = assertObjectType(extendedSchema.getType('Query')).getFields();
  const mutations = assertObjectType(extendedSchema.getType('Mutation')).getFields();

  queries.authConfig.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    const { config: oidc } = await effectiveOidc(context.db);
    return {
      secureLocalNet: secureLocalNet(),
      magicLink: sendsMagicLinks(context.auth),
      sso: oidc === null ? null : { name: oidc.name, signInUrl: `${serverUrl()}${SSO_START_PATH}` },
    };
  };

  mutations.requestSignIn.resolve = async (_parent: unknown, args: { email: string }, context: Context) => {
    const normalized = normalizeEmail(args.email);
    // Unauthenticated, so without the limiter anyone who can reach the port can
    // bury an inbox in links, or walk through addresses.
    throttle(context, AuthFlow.RequestSignIn, normalized);
    const email = parseOrThrow(emailInput, normalized);

    // SECURE_LOCAL_NET: the network is the credential, so the address alone opens the account.
    if (secureLocalNet()) {
      return { sent: false, session: await signInOnLocalNet(context, email) };
    }

    if (sendsMagicLinks(context.auth) === false) {
      throw badInput(
        'This instance cannot email sign-in links. Whoever runs it needs to set SMTP_URL, or SECURE_LOCAL_NET on a private network.',
      );
    }
    await context.auth.api.signInMagicLink({ body: { email, name: nameFor(email) }, headers: new Headers() });
    return { sent: true, session: null };
  };

  mutations.verifyMagicLink.resolve = async (_parent: unknown, args: { token: string }, context: Context) => {
    // By IP alone: until the token verifies there is no address to count against.
    throttle(context, AuthFlow.VerifyMagicLink);
    // BAD_USER_INPUT, not UNAUTHENTICATED: that one is what the client drops its
    // session on, and a bad link must not sign anyone out.
    if (sendsMagicLinks(context.auth) === false) {
      throw badInput(BAD_LINK);
    }
    try {
      const result = await context.auth.api.magicLinkVerify({ query: { token: args.token }, headers: new Headers() });
      return { token: result.token, userId: result.user.id };
    } catch {
      // Expired, used and unknown tokens answer the same.
      throw badInput(BAD_LINK);
    }
  };

  mutations.verifyOneTimeToken.resolve = async (_parent: unknown, args: { token: string }, context: Context) => {
    throttle(context, AuthFlow.VerifyOneTimeToken);
    // Spent, expired and made-up tokens all throw, and all mean the sign-in has
    // to be started again. None of them is an expired session.
    try {
      const result = await context.auth.api.verifyOneTimeToken({ body: { token: args.token }, headers: new Headers() });
      return { token: result.session.token, userId: result.user.id };
    } catch {
      throw badInput(BAD_SSO_TOKEN);
    }
  };

  mutations.signOut.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    const userId = await sessionUserId(context.auth, context.headers);
    if (userId === null) {
      return false;
    }
    await context.auth.api.signOut({ headers: context.headers });
    return true;
  };

  return extendedSchema;
}
