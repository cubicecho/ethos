import * as dbSchema from '@ethos/db/schema';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Auth, type MagicLink, sessionUserId } from '../../auth/better-auth.ts';
import { ErrorCode } from '../../core/errors.ts';
import {
  closeTestDb,
  createClient,
  createLinklessAuth,
  createTestAuth,
  createTestDb,
  createUser,
  resetTestDb,
  type TestClient,
  type TestDb,
} from '../helpers.ts';

const CONFIG = `query { authConfig { secureLocalNet magicLink } }`;
const REQUEST = `mutation ($email: String!) { signInMagicLink(email: $email) { status token userId } }`;
const VERIFY = `mutation ($token: String!) { magicLinkVerify(token: $token) { token user { id } } }`;
const SIGN_OUT = `mutation { signOut { success } }`;
const SESSION = `query { getSession { user { id email } session { userId } } }`;
const SESSIONS = `query { listSessions { token } }`;
const REVOKE_OTHERS = `mutation { revokeOtherSessions { status } }`;

let db: TestDb;
let auth: Auth;
let links: MagicLink[];
let anonymous: TestClient;

// Each test uses a fresh address, so no two of them can be read as one caller.
let addresses = 0;
const nextEmail = () => `user${++addresses}@example.com`;

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

/** Asks for a link for `email` and returns the token it was sent. */
async function linkTokenFor(email: string): Promise<string> {
  await anonymous.expectOk(REQUEST, { email });
  const link = links.at(-1);
  if (link === undefined) {
    throw new Error('No sign-in link was delivered.');
  }
  return link.token;
}

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => closeTestDb(db));

beforeEach(async () => {
  await resetTestDb(db);
  ({ auth, links } = createTestAuth(db));
  anonymous = createClient(db, null, { auth });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authConfig', () => {
  it('offers links when the instance can deliver them', async () => {
    const data = await anonymous.expectOk(CONFIG);
    expect(data.authConfig).toEqual({ secureLocalNet: false, magicLink: true });
  });

  it('offers nothing when the instance has no mail and no private network', async () => {
    const data = await createClient(db, null, { auth: createLinklessAuth(db) }).expectOk(CONFIG);
    expect(data.authConfig).toEqual({ secureLocalNet: false, magicLink: false });
  });

  it('says so under SECURE_LOCAL_NET', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const data = await anonymous.expectOk(CONFIG);
    expect(data.authConfig.secureLocalNet).toBe(true);
  });
});

describe('signInMagicLink', () => {
  it('delivers a link to the app and returns no session', async () => {
    const email = nextEmail();
    const data = await anonymous.expectOk(REQUEST, { email });
    expect(data.signInMagicLink).toEqual({ status: true, token: null, userId: null });
    expect(links).toHaveLength(1);
    expect(links[0]?.email).toBe(email);
    expect(links[0]?.url).toContain(`/auth/verify?token=${links[0]?.token}`);
  });

  it('never puts the link in the response or the log', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const data = await anonymous.expectOk(REQUEST, { email: nextEmail() });
    const token = links[0]?.token ?? '';
    expect(JSON.stringify(data)).not.toContain(token);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(token);
    logged.mockRestore();
  });

  it('refuses an address that is not one', async () => {
    const error = await anonymous.expectError(REQUEST, { email: 'not-an-address' });
    expect(error.code).toBe(ErrorCode.BadUserInput);
  });

  it('refuses, and says why, when the instance cannot deliver a link', async () => {
    const linkless = createClient(db, null, { auth: createLinklessAuth(db) });
    const error = await linkless.expectError(REQUEST, { email: nextEmail() });
    expect(error.code).toBe(ErrorCode.BadUserInput);
    expect(error.message).toContain('SMTP_URL');
  });

  it('signs straight in under SECURE_LOCAL_NET, with no link sent', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const data = await anonymous.expectOk(REQUEST, { email: nextEmail() });
    const { token, userId } = data.signInMagicLink;
    expect(links).toHaveLength(0);
    expect(await sessionUserId(auth, bearer(token))).toBe(userId);
  });

  it('opens the account that already has the address under SECURE_LOCAL_NET', async () => {
    vi.stubEnv('SECURE_LOCAL_NET', 'true');
    const existing = await createUser(db, 'kept@example.com');
    const data = await anonymous.expectOk(REQUEST, { email: ' Kept@Example.com ' });
    expect(data.signInMagicLink.userId).toBe(existing);
    expect(await db.select().from(dbSchema.users)).toHaveLength(1);
  });
});

describe('magicLinkVerify', () => {
  it('trades the link for a session the server recognises', async () => {
    const data = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(nextEmail()) });
    const { token, user } = data.magicLinkVerify;
    expect(await sessionUserId(auth, bearer(token))).toBe(user.id);
  });

  it('creates the account on first use and reuses it on the second', async () => {
    const email = nextEmail();
    const first = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email) });
    const second = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email) });
    expect(first.magicLinkVerify.user.id).toBe(second.magicLinkVerify.user.id);
  });

  it('opens an account made before sessions were kept in the database', async () => {
    const existing = await createUser(db, 'early@example.com');
    const data = await anonymous.expectOk(VERIFY, { token: await linkTokenFor('early@example.com') });
    expect(data.magicLinkVerify.user.id).toBe(existing);
  });

  it('treats addresses case-insensitively', async () => {
    const email = nextEmail();
    const lower = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email) });
    const upper = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email.toUpperCase()) });
    expect(upper.magicLinkVerify.user.id).toBe(lower.magicLinkVerify.user.id);
  });

  it('spends a link: the second use is refused', async () => {
    const token = await linkTokenFor(nextEmail());
    await anonymous.expectOk(VERIFY, { token });
    const error = await anonymous.expectError(VERIFY, { token });
    expect(error.code).toBe(ErrorCode.BadUserInput);
  });

  it('rejects a garbage token as bad input, not as an expired session', async () => {
    // UNAUTHENTICATED is what the client drops its token on; a bad link is a
    // bad argument and must not sign anyone out.
    const error = await anonymous.expectError(VERIFY, { token: 'not-a-token' });
    expect(error.code).toBe(ErrorCode.BadUserInput);
  });

  it('rejects a link that has run out', async () => {
    const token = await linkTokenFor(nextEmail());
    await db.update(dbSchema.verifications).set({ expiresAt: new Date(Date.now() - 1) });
    const error = await anonymous.expectError(VERIFY, { token });
    expect(error.code).toBe(ErrorCode.BadUserInput);
  });
});

/** Signs `email` in through a link, and returns a client carrying the session. */
async function signedIn(email: string): Promise<{ client: TestClient; token: string; userId: string }> {
  const verified = await anonymous.expectOk(VERIFY, { token: await linkTokenFor(email) });
  const { token, user } = verified.magicLinkVerify;
  return { client: createClient(db, user.id, { auth, headers: bearer(token) }), token, userId: user.id };
}

describe('signOut', () => {
  it('ends the session the request carries', async () => {
    const { client, token } = await signedIn(nextEmail());
    const data = await client.expectOk(SIGN_OUT);
    expect(data.signOut).toEqual({ success: true });
    expect(await sessionUserId(auth, bearer(token))).toBeNull();
  });

  it('answers false for a request that carries none', async () => {
    const data = await anonymous.expectOk(SIGN_OUT);
    expect(data.signOut).toEqual({ success: false });
  });
});

describe('sessions', () => {
  it("reads the caller's own session", async () => {
    const email = nextEmail();
    const { client, userId } = await signedIn(email);
    const data = await client.expectOk(SESSION);
    expect(data.getSession).toEqual({ user: { id: userId, email }, session: { userId } });
  });

  it('answers null for a request with no session', async () => {
    const data = await anonymous.expectOk(SESSION);
    expect(data.getSession).toBeNull();
  });

  it('lists every session of the account, and ends all but this one', async () => {
    const email = nextEmail();
    const { client, token } = await signedIn(email);
    const other = await signedIn(email);
    const listed = await client.expectOk(SESSIONS);
    expect(listed.listSessions.map((session: { token: string }) => session.token).sort()).toEqual(
      [token, other.token].sort(),
    );

    await client.expectOk(REVOKE_OTHERS);
    expect(await sessionUserId(auth, bearer(other.token))).toBeNull();
    expect(await sessionUserId(auth, bearer(token))).not.toBeNull();
  });

  it('refuses listing sessions without one as an expired session', async () => {
    const error = await anonymous.expectError(SESSIONS);
    expect(error.code).toBe(ErrorCode.Unauthenticated);
  });
});

describe('authentication', () => {
  it('refuses to read anything without a session', async () => {
    const error = await anonymous.expectError(`query { habits { id } }`);
    expect(error.code).toBe(ErrorCode.Unauthenticated);
  });

  it('shows a signed-in user only their own user row', async () => {
    const mine = await createUser(db, 'mine@example.com');
    await createUser(db, 'theirs@example.com');
    const data = await createClient(db, mine).expectOk(`query { users { id email } }`);
    expect(data.users).toEqual([{ id: mine, email: 'mine@example.com' }]);
  });

  it('keeps the auth tables out of the API', async () => {
    const mine = await createUser(db, 'curious@example.com');
    for (const field of ['sessions', 'accounts', 'verifications']) {
      const result = await createClient(db, mine).run(`query { ${field} { id } }`);
      expect(result.errors?.[0]?.message).toContain('Cannot query field');
    }
  });
});
