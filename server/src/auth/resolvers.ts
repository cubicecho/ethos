import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import jwt from 'jsonwebtoken';
import { appUrl, DEV_SECRET, isMagicLinkExposed, isMagicLinkRequired } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { AUTH_DEFAULTS } from '../core/defaults.ts';
import { badInput, rateLimited, unauthenticated } from '../core/errors.ts';
import { createRateLimiter } from './rate-limit.ts';

/** Read at call time so a test — or a reload — sees the current environment. */
function jwtSecret(): string {
  return process.env.JWT_SECRET ?? DEV_SECRET;
}

/** What an `Authorization` header starts with when it carries a session token. */
const BEARER_PREFIX = 'Bearer ';

// requestMagicLink is unauthenticated, so without this anyone who can reach the
// port can mint magic tokens at will. Per-IP limiting belongs in the reverse
// proxy, which is the only thing that reliably knows the client's address.
const signInLimiter = createRateLimiter();

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

/** A session token. Long-lived: there is no refresh flow and no session table. */
export function signToken(userId: string): string {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: `${AUTH_DEFAULTS.sessionTtlDays}d` });
}

/** A single-use-in-practice sign-in token, short-lived because it travels by mail. */
export function signMagicToken(email: string): string {
  return jwt.sign({ email }, jwtSecret(), { expiresIn: `${AUTH_DEFAULTS.magicLinkTtlMinutes}m` });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    const isSession = typeof payload === 'object' && typeof payload.userId === 'string';
    return isSession ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}

export function verifyMagicToken(token: string): { email: string } | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    const hasEmail = typeof payload === 'object' && typeof payload.email === 'string' && payload.email !== '';
    return hasEmail ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

/** Read the authenticated userId from a request's Bearer token, if any. */
export function extractUserId(request: { headers: { authorization?: string } }): string | null {
  const auth = request.headers.authorization;
  if (auth === undefined || auth.startsWith(BEARER_PREFIX) === false) {
    return null;
  }
  return verifyToken(auth.slice(BEARER_PREFIX.length))?.userId ?? null;
}

export function requireAuth(context: Context): string {
  if (!context.userId) {
    throw unauthenticated('Unauthenticated');
  }
  return context.userId;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Registration is open: completing a sign-in for an address that has never been
 * seen creates the account. Self-hosting is the deployment model, so the person
 * who can reach the instance is the person who is meant to have an account.
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

export function applyAuthExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, AUTH_SDL);
  const mutationType = assertObjectType(extendedSchema.getType('Mutation'));
  const fields = mutationType.getFields();

  fields.requestMagicLink.resolve = async (_parent: unknown, args: { email: string }, context: Context) => {
    const email = normalizeEmail(args.email);
    if (!signInLimiter.allow(email)) {
      throw rateLimited('Too many sign-in attempts. Try again in a few minutes.');
    }

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
    const payload = verifyMagicToken(args.token);
    if (!payload) {
      throw badInput('Invalid or expired magic link');
    }
    const userId = await findOrCreateUser(context.db, normalizeEmail(payload.email));
    return { token: signToken(userId), userId };
  };

  return extendedSchema;
}
