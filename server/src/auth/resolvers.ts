import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { oidcDeviceClientId, secureLocalNet, serverUrl } from '../core/config.ts';
import { type Context, Credential } from '../core/context.ts';
import { forbidden, unauthenticated } from '../core/errors.ts';
import { SSO_START_PATH } from '../http/sso.ts';
import { effectiveOidc } from '../sso/settings.ts';
import { sendsMagicLinks } from './better-auth.ts';

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
    """
    The public client a device app (Home Assistant) uses at the provider for the device flow (OIDC_DEVICE_CLIENT_ID),
    or null when none is set. Its access tokens, issued for this server's API audience, are accepted as a bearer.
    """
    deviceClientId: String
  }

  extend type Query {
    authConfig: AuthConfig!
  }
`);

/** What a key or a provider token that reaches for a session's operations is told. */
const SESSION_ONLY =
  'Only a person signed in to Ethos can do this. An API key or an access token from your provider cannot.';

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
 * Refuses an API key or a provider access token, for what is a session's alone: signing in and out, sessions, and
 * keys. Both act as their user on every row, but a key that could mint keys could mint its own successor, and a
 * token that could would leave a credential behind that outlives it and the provider's say over it. Nobody at all
 * passes, so signing in still works.
 *
 * @param context - The request context.
 * @throws FORBIDDEN for a key or a provider token. It is about the credential, and says nothing about a row.
 */
export function refuseUnlessSession(context: Context): void {
  const isDelegated = context.credential === Credential.ApiKey || context.credential === Credential.ProviderToken;
  if (isDelegated) {
    throw forbidden(SESSION_ONLY);
  }
}

/**
 * Adds `authConfig` to the generated schema. Signing in and out are better-auth's own endpoints (endpoints.ts).
 *
 * @param schema - The generated schema.
 * @returns The schema with `authConfig` on it.
 */
export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const queries = assertObjectType(extendedSchema.getType('Query')).getFields();

  queries.authConfig.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    const { config: oidc } = await effectiveOidc(context.db);
    return {
      secureLocalNet: secureLocalNet(),
      magicLink: sendsMagicLinks(context.auth),
      sso:
        oidc === null
          ? null
          : { name: oidc.name, signInUrl: `${serverUrl()}${SSO_START_PATH}`, deviceClientId: oidcDeviceClientId() },
    };
  };

  return extendedSchema;
}
