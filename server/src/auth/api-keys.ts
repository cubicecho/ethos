import { apikeys } from '@ethos/db/schema';
import { desc, eq } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { type Context, Credential } from '../core/context.ts';
import { forbidden } from '../core/errors.ts';
import { requireAuth } from './resolvers.ts';

// API keys: how another program calls Ethos as one of its users. Minting and
// revoking are better-auth's own `createApiKey` and `deleteApiKey`, served by
// endpoints.ts behind `requireKeyManager`. Listing is a plain read of the table,
// since better-auth's answer carries columns no client needs.

const API_KEYS_SDL = parse(`
  """An API key, without the key: only its hash is stored, and its first characters in the clear."""
  type ApiKey {
    id: ID!
    name: String
    """The key's first characters, prefix included, to tell keys apart."""
    start: String
    createdAt: DateTime!
    """When the key was last used, or null if it never has been."""
    lastRequest: DateTime
    """When the key stops working, or null if it never does."""
    expiresAt: DateTime
  }

  extend type Query {
    """The caller's API keys, newest first. A person's alone: a key cannot list keys."""
    apiKeys: [ApiKey!]!
  }
`);

/** What an `ApiKey` is read as: every column but the hash and the plugin's bookkeeping. */
const KEY_COLUMNS = {
  id: apikeys.id,
  name: apikeys.name,
  start: apikeys.start,
  createdAt: apikeys.createdAt,
  lastRequest: apikeys.lastRequest,
  expiresAt: apikeys.expiresAt,
};

/** What a key that reaches for a person's operations is told. */
const PEOPLE_ONLY = 'Only a signed-in person can do this. An API key cannot.';

/**
 * The caller's user id, as long as the caller is a person on a session. A key
 * that could mint, list or revoke keys could mint its own successor, so a leaked
 * one would never be revoked for good.
 *
 * @param context - The request context.
 * @returns The signed-in user's id.
 * @throws UNAUTHENTICATED for nobody, and FORBIDDEN for an API key. Neither says anything about a row.
 */
export function requireKeyManager(context: Context): string {
  const userId = requireAuth(context);
  refuseApiKey(context);
  return userId;
}

/**
 * Refuses an API key, for what is a person's alone: signing in and out, sessions, and keys.
 *
 * @param context - The request context.
 * @throws FORBIDDEN when the request carries an API key.
 */
export function refuseApiKey(context: Context): void {
  if (context.credential === Credential.ApiKey) {
    throw forbidden(PEOPLE_ONLY);
  }
}

/**
 * Adds `apiKeys` to the schema.
 *
 * @param schema - The schema so far.
 * @returns The schema with it.
 */
export function applyApiKeysExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, API_KEYS_SDL);
  const queries = assertObjectType(extendedSchema.getType('Query')).getFields();

  queries.apiKeys.resolve = (_parent: unknown, _args: unknown, context: Context) =>
    context.db
      .select(KEY_COLUMNS)
      .from(apikeys)
      .where(eq(apikeys.referenceId, requireKeyManager(context)))
      .orderBy(desc(apikeys.createdAt));

  return extendedSchema;
}
