import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import jwt from 'jsonwebtoken';
import { appUrl, isMagicLinkExposed, isMagicLinkRequired, jwtSecret } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { badInput, unauthenticated } from '../core/errors.ts';
import { AuthFlow, throttle } from './throttle.ts';

/** What an `Authorization` header starts with when it carries a session token. */
const BEARER_PREFIX = 'Bearer ';

const AUTH_SDL = parse(`
  """
  The outcome of a sign-in request. When the instance runs with
  AUTH_MAGIC_LINK=false there is no link to follow, so a live session comes back
  immediately in \`token\`/\`userId\`. When magic links are on, \`magicLink\` is
  filled in only where exposing it is enabled.
  """
  type RequestMagicLinkResult {
    ok: Boolean!
    magicLink: String
    token: String
    userId: ID
  }

  type AuthPayload {
    token: String!
    userId: ID!
  }

  extend type Mutation {
    requestMagicLink(email: String!): RequestMagicLinkResult!
    verifyMagicLink(token: String!): AuthPayload!
  }
`);

/**
 * A session token. Long-lived: there is no refresh flow and no session table.
 *
 * @param userId - The user the token signs in.
 * @returns The signed JWT.
 */
export function signToken(userId: string): string {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: `${AUTH_DEFAULTS.sessionTtlDays}d` });
}

/**
 * A single-use-in-practice sign-in token, short-lived because it travels by mail.
 *
 * @param email - The address the link was asked for.
 * @returns The signed JWT.
 */
export function signMagicToken(email: string): string {
  return jwt.sign({ email }, jwtSecret(), { expiresIn: `${AUTH_DEFAULTS.magicLinkTtlMinutes}m` });
}

/**
 * Reads a session token.
 *
 * @param token - The JWT as sent.
 * @returns The user it names, or null when it is forged, expired or not a session token.
 */
export function verifyToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    const isSession = typeof payload === 'object' && typeof payload.userId === 'string';
    return isSession ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}

/**
 * Reads a sign-in token.
 *
 * @param token - The JWT from the link.
 * @returns The address it names, or null when it is forged, expired or names none.
 */
export function verifyMagicToken(token: string): { email: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    const hasEmail = typeof payload === 'object' && typeof payload.email === 'string' && payload.email !== '';
    return hasEmail ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

/**
 * Read the authenticated userId from a request's Bearer token, if any.
 *
 * @param request - The incoming request; only its `Authorization` header is read.
 * @returns The user id, or null when there is no valid Bearer token.
 */
export function extractUserId(request: { headers: { authorization?: string } }): string | null {
  const auth = request.headers.authorization;
  if (auth === undefined || auth.startsWith(BEARER_PREFIX) === false) {
    return null;
  }
  return verifyToken(auth.slice(BEARER_PREFIX.length))?.userId ?? null;
}

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
 * Registration is open: completing a sign-in for an address that has never been
 * seen creates the account. Self-hosting is the deployment model, so the person
 * who can reach the instance is the person who is meant to have an account.
 *
 * @param db - The database.
 * @param email - The address, already normalized.
 * @returns The user's id.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 column type compat
export async function findOrCreateUser(db: any, email: string): Promise<string> {
  const existing = await db
    .select({ id: dbSchema.users.id })
    .from(dbSchema.users)
    .where(eq(dbSchema.users.email, email));
  if (existing.length > 0) {
    return existing[0].id;
  }

  const [created] = await db.insert(dbSchema.users).values({ email }).returning({ id: dbSchema.users.id });
  // Not a caller's mistake, so not a coded error: the server reports it as its own failure.
  if (!created) {
    throw new Error('The users insert returned no row.');
  }
  return created.id;
}

/**
 * Adds the sign-in mutations to the generated schema.
 *
 * @param schema - The generated schema.
 * @returns The schema with `requestMagicLink` and `verifyMagicLink` on it.
 */
export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const mutationType = assertObjectType(extendedSchema.getType('Mutation'));
  const fields = mutationType.getFields();

  fields.requestMagicLink.resolve = async (_parent: unknown, args: { email: string }, context: Context) => {
    const email = normalizeEmail(args.email);
    // Unauthenticated, so without the limiter anyone who can reach the port can
    // mint magic tokens at will.
    throttle(context, AuthFlow.RequestMagicLink, email);

    // No-link mode: the address alone is the credential. Private instances
    // only — see the README's "Before you expose it".
    if (isMagicLinkRequired() === false) {
      const userId = await findOrCreateUser(context.db, email);
      console.log(`[auth] Magic links are off; signed ${email} in directly.`);
      return { ok: true, magicLink: null, token: signToken(userId), userId };
    }

    const magicLink = `${appUrl()}/auth/verify?token=${signMagicToken(email)}`;
    // Ethos ships no mail provider, so the console is the delivery channel.
    console.log(`\n[auth] Magic link for ${email}:\n${magicLink}\n`);
    return { ok: true, magicLink: isMagicLinkExposed() ? magicLink : null, token: null, userId: null };
  };

  fields.verifyMagicLink.resolve = async (_parent: unknown, args: { token: string }, context: Context) => {
    // By IP alone: until the token verifies there is no address to count against.
    throttle(context, AuthFlow.VerifyMagicLink);
    const payload = verifyMagicToken(args.token);
    if (!payload) {
      throw badInput('Invalid or expired magic link');
    }
    const userId = await findOrCreateUser(context.db, normalizeEmail(payload.email));
    return { token: signToken(userId), userId };
  };

  return extendedSchema;
}
