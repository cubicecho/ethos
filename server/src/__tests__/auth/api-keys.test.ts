import type { Server } from 'node:http';
import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import { API_KEY_HEADER, API_KEY_PREFIX, type Auth } from '../../auth/better-auth.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createApp } from '../../http/app.ts';
import {
  closeTestDb,
  createApiKeyFor,
  createClient,
  createSessionToken,
  createTestAuth,
  createTestDb,
  createUser,
  portOf,
  type TestDb,
} from '../helpers.ts';

// API keys over a real socket, through the context factory /graphql and /mcp
// share: a key minted the way Settings mints one, then used the way another
// program would use it. What is asserted is that a key is its owner and nobody
// else, stops at once when revoked, and cannot manage keys or sessions itself.

const CREATE_HABIT = 'mutation ($values: CreateHabitInput!) { createHabit(values: $values) { id } }';
const HABITS = '{ habits { id name } }';
const CREATE_KEY = 'mutation ($name: String) { createApiKey(name: $name) { id key start name } }';
const LIST_KEYS = '{ apiKeys { id name start lastRequest expiresAt } }';
const DELETE_KEY = 'mutation ($id: String!) { deleteApiKey(keyId: $id) { success } }';
const MARK = 'mutation ($id: ID!, $day: String!) { markHabit(habitId: $id, day: $day) { id } }';

// Derived from the real clock: `markHabit` refuses a day that has not happened yet.
const today = new Date().toISOString().slice(0, 10);

/** More requests than the plugin's own default allows a key in a day. */
const PAST_PLUGIN_DAILY_LIMIT = 12;

let db: TestDb;
let auth: Auth;
let server: Server;
let base: string;
let aliceId: string;
let bobId: string;
let aliceSession: string;
let bobSession: string;
let aliceHabitId: string;
let bobHabitId: string;

/** A GraphQL response body, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own query asked for
type AnyBody = any;

/**
 * Posts an operation to /graphql.
 *
 * @param headers - The credential headers to send.
 * @param query - The operation.
 * @param [variables] - Its variables.
 * @returns The response body.
 */
async function ask(headers: Record<string, string>, query: string, variables?: object): Promise<AnyBody> {
  const response = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

/** Headers for a person on a session. */
const session = (token: string) => ({ authorization: `Bearer ${token}` });
/** Headers for a program holding a key. */
const key = (value: string) => ({ [API_KEY_HEADER]: value });

/** The first error's code. */
const codeOf = (body: AnyBody) => body.errors?.[0]?.extensions?.code;

/**
 * Mints a key the way Settings does: `createApiKey`, on the owner's session.
 *
 * @param token - The owner's session.
 * @param [name] - What the key is called.
 * @returns The minted key, as `createApiKey` answers.
 */
async function mint(
  token: string,
  name = 'auto-cal',
): Promise<{ id: string; key: string; start: string; name: string }> {
  const body = await ask(session(token), CREATE_KEY, { name });
  expect(body.errors).toBeUndefined();
  return body.data.createApiKey;
}

beforeAll(async () => {
  db = await createTestDb();
  auth = createTestAuth(db).auth;
  aliceId = await createUser(db, 'alice@example.com');
  bobId = await createUser(db, 'bob@example.com');
  aliceHabitId = (await createClient(db, aliceId).expectOk(CREATE_HABIT, { values: { name: 'Read' } })).createHabit.id;
  bobHabitId = (await createClient(db, bobId).expectOk(CREATE_HABIT, { values: { name: 'Run' } })).createHabit.id;
  aliceSession = await createSessionToken(auth, aliceId);
  bobSession = await createSessionToken(auth, bobId);
  server = (await createApp({ db, authHost: fixedAuthHost(auth) })).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeTestDb(db);
});

describe('a key', () => {
  it("queries /graphql as its owner, and sees only the owner's rows", async () => {
    const { key: value } = await mint(aliceSession);
    const body = await ask(key(value), HABITS);
    expect(body.errors).toBeUndefined();
    expect(body.data.habits).toEqual([{ id: aliceHabitId, name: 'Read' }]);
  });

  it("reaches for another user's habit and finds nothing: NOT_FOUND, never FORBIDDEN", async () => {
    const { key: value } = await mint(aliceSession);
    expect(codeOf(await ask(key(value), MARK, { id: bobHabitId, day: today }))).toBe(ErrorCode.NotFound);
    const read = await ask(key(value), 'query ($id: UUID!) { habit(where: { id: { eq: $id } }) { id } }', {
      id: bobHabitId,
    });
    expect(read.data.habit).toBeNull();
  });

  it('writes as its owner, too', async () => {
    const { key: value } = await mint(aliceSession);
    const body = await ask(key(value), MARK, { id: aliceHabitId, day: today });
    expect(body.errors).toBeUndefined();
    const [entry] = await db
      .select()
      .from(dbSchema.habitEntries)
      .where(eq(dbSchema.habitEntries.habitId, aliceHabitId));
    expect(entry.userId).toBe(aliceId);
  });

  it('gets UNAUTHENTICATED once revoked', async () => {
    const minted = await mint(aliceSession);
    expect((await ask(key(minted.key), HABITS)).errors).toBeUndefined();
    const revoked = await ask(session(aliceSession), DELETE_KEY, { id: minted.id });
    expect(revoked.data.deleteApiKey).toEqual({ success: true });
    expect(codeOf(await ask(key(minted.key), HABITS))).toBe(ErrorCode.Unauthenticated);
  });

  it('gets UNAUTHENTICATED once expired', async () => {
    const minted = await mint(aliceSession);
    await db
      .update(dbSchema.apikeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(dbSchema.apikeys.id, minted.id));
    expect(codeOf(await ask(key(minted.key), HABITS))).toBe(ErrorCode.Unauthenticated);
  });

  it('that is not one is nobody, even beside a live session', async () => {
    expect(codeOf(await ask(key(`${API_KEY_PREFIX}not-a-key`), HABITS))).toBe(ErrorCode.Unauthenticated);
    const both = await ask({ ...key('not-a-key'), ...session(aliceSession) }, HABITS);
    expect(codeOf(both)).toBe(ErrorCode.Unauthenticated);
  });

  it("is not held to the plugin's ten requests a day", async () => {
    const { key: value } = await mint(aliceSession);
    for (let request = 0; request < PAST_PLUGIN_DAILY_LIMIT; request += 1) {
      expect((await ask(key(value), HABITS)).errors).toBeUndefined();
    }
  });

  it('is shown once, and only its hash is stored', async () => {
    const minted = await mint(aliceSession);
    expect(minted.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(minted.key.startsWith(minted.start)).toBe(true);
    const [row] = await db.select().from(dbSchema.apikeys).where(eq(dbSchema.apikeys.id, minted.id));
    expect(row.referenceId).toBe(aliceId);
    expect(row.key).not.toContain(minted.key.slice(API_KEY_PREFIX.length));
    const listed = await ask(session(aliceSession), LIST_KEYS);
    expect(JSON.stringify(listed)).not.toContain(minted.key);
  });

  it('cannot mint, list or revoke keys, nor reach the sessions of its owner', async () => {
    const minted = await mint(aliceSession);
    const asKey = key(minted.key);
    expect(codeOf(await ask(asKey, CREATE_KEY, { name: 'successor' }))).toBe(ErrorCode.Forbidden);
    expect(codeOf(await ask(asKey, LIST_KEYS))).toBe(ErrorCode.Forbidden);
    expect(codeOf(await ask(asKey, DELETE_KEY, { id: minted.id }))).toBe(ErrorCode.Forbidden);
    expect(codeOf(await ask(asKey, '{ listSessions { id } }'))).toBe(ErrorCode.Forbidden);
    expect(codeOf(await ask(asKey, 'mutation { signOut { success } }'))).toBe(ErrorCode.Forbidden);
  });

  it('table is not in the API', async () => {
    expect(codeOf(await ask(session(aliceSession), '{ apikeys { id } }'))).toBe('GRAPHQL_VALIDATION_FAILED');
  });
});

describe('managing keys', () => {
  it("lists the caller's keys, newest first, and nobody else's", async () => {
    const first = await createApiKeyFor(auth, bobId, 'first');
    const second = await createApiKeyFor(auth, bobId, 'second');
    const listed = await ask(session(bobSession), LIST_KEYS);
    expect(listed.data.apiKeys.map((row: { id: string }) => row.id)).toEqual([second.id, first.id]);
    const alices = await ask(session(aliceSession), LIST_KEYS);
    expect(alices.data.apiKeys.map((row: { id: string }) => row.id)).not.toContain(first.id);
  });

  it("revokes someone else's key as NOT_FOUND, and leaves it working", async () => {
    const bobs = await createApiKeyFor(auth, bobId);
    expect(codeOf(await ask(session(aliceSession), DELETE_KEY, { id: bobs.id }))).toBe(ErrorCode.NotFound);
    expect((await ask(key(bobs.key), HABITS)).data.habits).toEqual([{ id: bobHabitId, name: 'Run' }]);
  });

  it('answers an id that is no key as NOT_FOUND', async () => {
    expect(codeOf(await ask(session(aliceSession), DELETE_KEY, { id: 'not-a-uuid' }))).toBe(ErrorCode.NotFound);
    expect(codeOf(await ask(session(aliceSession), DELETE_KEY, { id: crypto.randomUUID() }))).toBe(ErrorCode.NotFound);
  });

  it('needs a name', async () => {
    expect(codeOf(await ask(session(aliceSession), CREATE_KEY, { name: '   ' }))).toBe(ErrorCode.BadUserInput);
    expect(codeOf(await ask(session(aliceSession), CREATE_KEY, {}))).toBe(ErrorCode.BadUserInput);
  });

  it('trims the name it is given', async () => {
    expect((await mint(aliceSession, '  dashboard  ')).name).toBe('dashboard');
  });

  it('lasts from a day to a year, which is what Settings offers', async () => {
    const EXPIRING = 'mutation ($s: Float!) { createApiKey(name: "x", expiresIn: $s) { expiresAt } }';
    const DAY_SECONDS = 86_400;
    expect(codeOf(await ask(session(aliceSession), EXPIRING, { s: 60 }))).toBe(ErrorCode.BadUserInput);
    expect(codeOf(await ask(session(aliceSession), EXPIRING, { s: 400 * DAY_SECONDS }))).toBe(ErrorCode.BadUserInput);
    const yearly = await ask(session(aliceSession), EXPIRING, { s: 365 * DAY_SECONDS });
    expect(new Date(yearly.data.createApiKey.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 364 * DAY_SECONDS * 1000,
    );
  });

  it('needs someone signed in', async () => {
    expect(codeOf(await ask({}, CREATE_KEY, { name: 'x' }))).toBe(ErrorCode.Unauthenticated);
    expect(codeOf(await ask({}, LIST_KEYS))).toBe(ErrorCode.Unauthenticated);
  });
});
