import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { secureLocalNet, serverUrl } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { unauthenticated } from '../core/errors.ts';
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
  }

  extend type Query {
    authConfig: AuthConfig!
  }
`);

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
      sso: oidc === null ? null : { name: oidc.name, signInUrl: `${serverUrl()}${SSO_START_PATH}` },
    };
  };

  return extendedSchema;
}
