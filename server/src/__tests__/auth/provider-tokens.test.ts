import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import express from 'express';
import { type CryptoKey, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import { API_KEY_HEADER, type Auth } from '../../auth/better-auth.ts';
import { ACCESS_TOKEN_TYP } from '../../auth/provider-tokens.ts';
import { OIDC_PROVIDER_ID, type OidcConfig, oidcApiAudience, serverUrl } from '../../core/config.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createApp } from '../../http/app.ts';
import { PROTECTED_RESOURCE_PATH } from '../../http/protected-resource.ts';
import {
  closeTestDb,
  createApiKeyFor,
  createClient,
  createTestAuth,
  createTestDb,
  createUser,
  resetTestDb,
  type TestDb,
} from '../helpers.ts';

// Access tokens the OIDC provider issued for this API (RFC 9068), as a device
// app (Home Assistant) sends them after the device flow: against the real app
// over HTTP, with a stand-in provider serving discovery and a JWKS on a
// loopback port, and tokens signed with its key here.

const HABITS = '{ habits { id name } }';
const CREATE_HABIT = 'mutation ($values: CreateHabitInput!) { createHabit(values: $values) { id } }';
const MARK = 'mutation ($id: ID!, $day: String!) { markHabit(habitId: $id, day: $day) { id } }';
const SUB = 'heautou-user-1';
const DEVICE_CLIENT = 'home-assistant';
/** How long a minted token lasts unless a test says otherwise. */
const TOKEN_SECONDS = 600;
/** Far enough in the past that the clock tolerance does not cover it. */
const EXPIRED_SECONDS = -120;

// Derived from the real clock: `markHabit` refuses a day that has not happened yet.
const today = new Date().toISOString().slice(0, 10);

interface FakeProvider {
  issuer: string;
  /** Signs a token as the provider would, with whatever the test changes. */
  mint(options?: MintOptions): Promise<string>;
  close(): Promise<void>;
}

interface MintOptions {
  claims?: JWTPayload;
  typ?: string;
  issuer?: string;
  audience?: string | string[];
  /** Seconds from now. */
  expiresIn?: number;
  /** A key the provider's JWKS does not have. */
  key?: CryptoKey;
}

/** A GraphQL response body, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own query asked for
type AnyBody = any;

/**
 * Listens on a free loopback port.
 *
 * @param server - The server to start.
 * @returns The origin it answers on.
 */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * Stops a server, dropping its keep-alive connections.
 *
 * @param server - The server to stop.
 * @returns Once it has stopped.
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

/**
 * Starts the stand-in provider: discovery and a JWKS with one RS256 key.
 *
 * @returns The provider.
 */
async function startProvider(): Promise<FakeProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const app = express();
  const server = createServer(app);
  const issuer = `${await listen(server)}/oidc`;
  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer,
      jwks_uri: `${issuer}/jwks`,
      // HS256 is advertised and must still never be accepted.
      id_token_signing_alg_values_supported: ['RS256', 'HS256'],
    });
  });
  app.get('/oidc/jwks', (_req, res) => {
    res.json({ keys: [jwk] });
  });
  return {
    issuer,
    async mint(options = {}) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ client_id: DEVICE_CLIENT, scope: 'openid', ...options.claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: options.typ ?? ACCESS_TOKEN_TYP })
        .setIssuer(options.issuer ?? issuer)
        .setAudience(options.audience ?? oidcApiAudience())
        .setSubject(typeof options.claims?.sub === 'string' ? options.claims.sub : SUB)
        .setIssuedAt(now)
        .setExpirationTime(now + (options.expiresIn ?? TOKEN_SECONDS))
        .sign(options.key ?? privateKey);
    },
    close: () => close(server),
  };
}

/**
 * Builds a JWT with no signature at all.
 *
 * @param payload - Its claims.
 * @returns The token.
 */
function unsigned(payload: JWTPayload): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: ACCESS_TOKEN_TYP })}.${part(payload)}.`;
}

let db: TestDb;
let provider: FakeProvider;
let ethos: Server | null = null;
let base: string;
let auth: Auth;
let adaId: string;
let graceId: string;
let adaHabitId: string;
let graceHabitId: string;

/**
 * Serves the real app, with or without the stand-in provider in effect.
 *
 * @param withProvider - Whether the provider is the instance's.
 */
async function serve(withProvider: boolean): Promise<void> {
  const oidc: OidcConfig | null = withProvider
    ? {
        issuer: provider.issuer,
        clientId: 'ethos',
        clientSecret: undefined,
        clientAuth: 'client_secret_basic',
        name: 'heautou',
      }
    : null;
  auth = createTestAuth(db, oidc).auth;
  const app = await createApp({ db, authHost: fixedAuthHost(auth, oidc), mcp: true });
  ethos = createServer(app);
  base = await listen(ethos);
}

/**
 * Posts an operation to /graphql.
 *
 * @param headers - The credential headers to send.
 * @param query - The operation.
 * @param [variables] - Its variables.
 * @returns The response, and its body.
 */
async function post(headers: Record<string, string>, query: string, variables?: object) {
  const response = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  return { response, body: (await response.json()) as AnyBody };
}

/** Headers for a bearer. */
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** The first error's code. */
const codeOf = (body: AnyBody) => body.errors?.[0]?.extensions?.code;

/**
 * Lists habits as a token's holder.
 *
 * @param token - The bearer.
 * @returns The first error's code, or undefined when it answered.
 */
async function codeFor(token: string): Promise<unknown> {
  return codeOf((await post(bearer(token), HABITS)).body);
}

beforeAll(async () => {
  db = await createTestDb();
  provider = await startProvider();
});

afterAll(async () => {
  await provider.close();
  await closeTestDb(db);
});

beforeEach(async () => {
  await resetTestDb(db);
  adaId = await createUser(db, 'ada@example.com');
  graceId = await createUser(db, 'grace@example.com');
  adaHabitId = (await createClient(db, adaId).expectOk(CREATE_HABIT, { values: { name: 'Read' } })).createHabit.id;
  graceHabitId = (await createClient(db, graceId).expectOk(CREATE_HABIT, { values: { name: 'Run' } })).createHabit.id;
  // What a browser sign-in through the provider leaves behind (http/sso.test.ts checks it does).
  await db.insert(dbSchema.accounts).values({ userId: adaId, providerId: OIDC_PROVIDER_ID, accountId: SUB });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (ethos !== null) {
    await close(ethos);
    ethos = null;
  }
});

describe('a provider access token as a bearer', () => {
  beforeEach(() => serve(true));

  it('signs the linked person in, for reads and writes alike', async () => {
    const token = await provider.mint();
    const created = await post(bearer(token), CREATE_HABIT, { values: { name: 'Water the plants' } });
    expect(created.body.errors).toBeUndefined();
    const habitId = created.body.data.createHabit.id;
    expect((await post(bearer(token), MARK, { id: habitId, day: today })).body.errors).toBeUndefined();

    const { body } = await post(bearer(token), HABITS);
    const ids = body.data.habits.map((habit: { id: string }) => habit.id);
    expect(ids.sort()).toEqual([adaHabitId, habitId].sort());
    const [habit] = await db.select().from(dbSchema.habits).where(eq(dbSchema.habits.id, habitId));
    expect(habit.userId).toBe(adaId);
  });

  it("reaches for someone else's habit and finds nothing: NOT_FOUND, never FORBIDDEN", async () => {
    const token = await provider.mint();
    expect(codeOf((await post(bearer(token), MARK, { id: graceHabitId, day: today })).body)).toBe(ErrorCode.NotFound);
  });

  it('accepts a token with no scope and no client_id, as heautou issues for an API without scopes', async () => {
    expect(await codeFor(await provider.mint({ claims: { client_id: undefined, scope: undefined } }))).toBeUndefined();
  });

  it('accepts an audience among several', async () => {
    expect(await codeFor(await provider.mint({ audience: ['someone-else', oidcApiAudience()] }))).toBeUndefined();
  });

  it.each([
    ['another audience', { audience: 'https://other.example.com/graphql' }],
    ['another issuer', { issuer: 'https://evil.example.com/oidc' }],
    ['an id token typ', { typ: 'JWT' }],
    ['an expired token', { expiresIn: EXPIRED_SECONDS }],
  ])('refuses %s as UNAUTHENTICATED', async (_name, options: MintOptions) => {
    expect(await codeFor(await provider.mint(options))).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses a token signed with a key the provider does not publish', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    expect(await codeFor(await provider.mint({ key: privateKey }))).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses an unsigned token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = unsigned({ iss: provider.issuer, aud: oidcApiAudience(), sub: SUB, iat: now, exp: now + 600 });
    expect(await codeFor(token)).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses an HS256 token, whatever the provider advertises', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ client_id: DEVICE_CLIENT })
      .setProtectedHeader({ alg: 'HS256', typ: ACCESS_TOKEN_TYP })
      .setIssuer(provider.issuer)
      .setAudience(oidcApiAudience())
      .setSubject(SUB)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(new TextEncoder().encode('a-secret-the-attacker-chose-0123456789'));
    expect(await codeFor(token)).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses a sub no Ethos account signed in with, even with a matching address', async () => {
    const token = await provider.mint({ claims: { sub: 'heautou-user-2', email: 'grace@example.com' } });
    expect(await codeFor(token)).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses the token of a person whose account was deleted', async () => {
    await db.delete(dbSchema.users).where(eq(dbSchema.users.id, adaId));
    expect(await codeFor(await provider.mint())).toBe(ErrorCode.Unauthenticated);
  });

  it('challenges a refused bearer with where to get a good one', async () => {
    const { response } = await post(bearer(await provider.mint({ expiresIn: EXPIRED_SECONDS })), HABITS);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", resource_metadata="${serverUrl()}${PROTECTED_RESOURCE_PATH}"`,
    );
  });

  it('sends no challenge to a good token', async () => {
    const { response } = await post(bearer(await provider.mint()), HABITS);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('works on /mcp too, through the same caller', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...bearer(await provider.mint()),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'habits', arguments: {} } }),
    });
    const text = JSON.stringify((await response.json()).result);
    expect(text).toContain('Read');
    expect(text).not.toContain('Run');
  });

  it('cannot mint, list or revoke keys, nor reach sessions: those are a session alone', async () => {
    const token = bearer(await provider.mint());
    const key = await createApiKeyFor(auth, adaId);
    expect(codeOf((await post(token, 'mutation { createApiKey(name: "x") { key } }')).body)).toBe(ErrorCode.Forbidden);
    expect(codeOf((await post(token, '{ apiKeys { id } }')).body)).toBe(ErrorCode.Forbidden);
    const revoke = 'mutation ($id: String!) { deleteApiKey(keyId: $id) { success } }';
    expect(codeOf((await post(token, revoke, { id: key.id })).body)).toBe(ErrorCode.Forbidden);
    expect(codeOf((await post(token, '{ listSessions { id } }')).body)).toBe(ErrorCode.Forbidden);
    expect(codeOf((await post(token, 'mutation { signOut { success } }')).body)).toBe(ErrorCode.Forbidden);
  });
});

describe('a provider access token beside an API key', () => {
  beforeEach(() => serve(true));

  it("gives way to a good key: the request is the key's owner", async () => {
    const graceKey = await createApiKeyFor(auth, graceId);
    const both = { [API_KEY_HEADER]: graceKey.key, ...bearer(await provider.mint()) };
    const { body } = await post(both, HABITS);
    expect(body.data.habits).toEqual([{ id: graceHabitId, name: 'Run' }]);
  });

  it('does not stand in for a key that does not hold', async () => {
    const both = { [API_KEY_HEADER]: 'ethos_not-a-key', ...bearer(await provider.mint()) };
    expect(codeOf((await post(both, HABITS)).body)).toBe(ErrorCode.Unauthenticated);
  });
});

describe('with no provider', () => {
  beforeEach(() => serve(false));

  it('refuses every JWT', async () => {
    expect(await codeFor(await provider.mint())).toBe(ErrorCode.Unauthenticated);
  });

  it('sends no challenge', async () => {
    const { response } = await post(bearer(await provider.mint()), HABITS);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });
});

describe('protected-resource metadata', () => {
  it('names the provider and the audience', async () => {
    await serve(true);
    const response = await fetch(`${base}${PROTECTED_RESOURCE_PATH}`);
    expect(await response.json()).toEqual({
      resource: oidcApiAudience(),
      authorization_servers: [provider.issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'Ethos',
    });
  });

  it('is served under the resource path too', async () => {
    await serve(true);
    const response = await fetch(`${base}${PROTECTED_RESOURCE_PATH}/graphql`);
    expect((await response.json()).resource).toBe(oidcApiAudience());
  });

  it('names no authorization server without a provider', async () => {
    await serve(false);
    const response = await fetch(`${base}${PROTECTED_RESOURCE_PATH}`);
    expect((await response.json()).authorization_servers).toEqual([]);
  });

  it('takes the audience from OIDC_API_AUDIENCE', async () => {
    vi.stubEnv('OIDC_API_AUDIENCE', 'https://ethos.example.com/api');
    await serve(true);
    const response = await fetch(`${base}${PROTECTED_RESOURCE_PATH}`);
    expect((await response.json()).resource).toBe('https://ethos.example.com/api');
    // And a token for it is the one accepted.
    expect(await codeFor(await provider.mint({ audience: 'https://ethos.example.com/api' }))).toBeUndefined();
    expect(await codeFor(await provider.mint({ audience: `${serverUrl()}/graphql` }))).toBe(ErrorCode.Unauthenticated);
  });
});
