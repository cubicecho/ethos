import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from '../../auth/admin.ts';
import { type AuthHost, createAuthHost } from '../../auth/auth-host.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { mountSso, SSO_START_PATH } from '../../http/sso.ts';
import { DEVICE_CODE_GRANT, forgetDeviceClientCheck } from '../../sso/device-client.ts';
import { PairingFailure, parseSetupUrl } from '../../sso/pairing.ts';
import { readPairedOidc, SsoSource } from '../../sso/settings.ts';
import {
  closeTestDb,
  createClient,
  createTestDb,
  createUser,
  resetTestDb,
  TEST_SECRET,
  type TestDb,
} from '../helpers.ts';

// Pairing with a provider by pasting a setup URL, against a stand-in for
// heautou's Dynamic Client Registration: discovery naming a registration
// endpoint, registration on an initial access token (RFC 7591), and deleting
// the client on its registration access token (RFC 7592).

const SETUP = 'query { ssoSetup { source issuer name canPair redirectUri } }';
const PAIR = 'mutation ($url: String!) { pairSso(setupUrl: $url) { source name canPair } }';
const UNPAIR = 'mutation { unpairSso { source name } }';
const CONFIG = '{ authConfig { sso { name signInUrl deviceClientId } } }';

const TOKEN = 'iat-good';
const CLIENT_ID = 'ethos-client';
const CLIENT_SECRET = 'ethos-secret';
const RAT = 'rat-1';
const DEVICE_ID = 'ethos-devices';
const DEVICE_RAT = 'rat-device';
const DEVICE_CONFIG = '{ authConfig { sso { deviceClientId } } }';

interface FakeDcr {
  issuer: string;
  /** What discovery says the issuer is. Set to something else to forge it. */
  claimedIssuer: string;
  /** Whether discovery names a registration endpoint. */
  canRegister: boolean;
  /** What the next registration answers, when the token is good. */
  answer: 'created' | 'badRedirect' | 'rateLimited';
  /** Bodies and auth headers registration was called with. */
  registrations: { body: Record<string, unknown>; authorization: string | undefined }[];
  /** Auth headers the client was deleted with. */
  deletions: (string | undefined)[];
  /** What deleting answers. */
  deleteStatus: number;
  /** Whether discovery offers the device flow. */
  hasDeviceFlow: boolean;
  /** Whether a second registration with the same token is allowed, as heautou allows one device client. */
  allowsDeviceClient: boolean;
  /** Whether the provider's admin has turned the device client's device flow on. */
  isDeviceFlowOn: boolean;
  /** Whether the device client still exists. */
  hasDeviceClient: boolean;
  /** How many times the device client's registration was read. */
  deviceReads: number;
  close(): Promise<void>;
}

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
 * Starts the stand-in provider, ready to register one client.
 *
 * @returns The provider and what it was asked.
 */
async function startDcr(): Promise<FakeDcr> {
  const app = express();
  const server = createServer(app);
  const issuer = `${await listen(server)}/oidc`;
  const fake: FakeDcr = {
    issuer,
    claimedIssuer: issuer,
    canRegister: true,
    answer: 'created',
    registrations: [],
    deletions: [],
    deleteStatus: 204,
    hasDeviceFlow: false,
    allowsDeviceClient: true,
    isDeviceFlowOn: false,
    hasDeviceClient: false,
    deviceReads: 0,
    close: () => close(server),
  };
  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: fake.claimedIssuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      ...(fake.canRegister ? { registration_endpoint: `${issuer}/reg` } : {}),
      ...(fake.hasDeviceFlow ? { device_authorization_endpoint: `${issuer}/device/auth` } : {}),
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
  });
  app.post('/oidc/reg', express.json(), (req, res) => {
    fake.registrations.push({ body: req.body, authorization: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.status(401).json({ error: 'invalid_token', error_description: 'invalid token provided' });
      return;
    }
    if (fake.answer === 'rateLimited') {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    if (fake.answer === 'badRedirect') {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must use https' });
      return;
    }
    if (req.body.token_endpoint_auth_method === 'none') {
      if (fake.allowsDeviceClient === false) {
        res.status(401).json({ error: 'invalid_token', error_description: 'the setup URL has been used' });
        return;
      }
      fake.hasDeviceClient = true;
      // Held back until the admin turns it on, so the answer lists no grant types.
      res.status(201).json({
        ...req.body,
        grant_types: [],
        client_id: DEVICE_ID,
        registration_access_token: DEVICE_RAT,
        registration_client_uri: `${issuer}/reg/${DEVICE_ID}`,
      });
      return;
    }
    res.status(201).json({
      ...req.body,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      registration_access_token: RAT,
      registration_client_uri: `${issuer}/reg/${CLIENT_ID}`,
    });
  });
  app.delete(`/oidc/reg/${CLIENT_ID}`, (req, res) => {
    fake.deletions.push(req.headers.authorization);
    res.status(fake.deleteStatus).end();
  });
  app.get(`/oidc/reg/${DEVICE_ID}`, (req, res) => {
    fake.deviceReads += 1;
    if (req.headers.authorization !== `Bearer ${DEVICE_RAT}` || fake.hasDeviceClient === false) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    res.json({ client_id: DEVICE_ID, grant_types: fake.isDeviceFlowOn ? [DEVICE_CODE_GRANT, 'refresh_token'] : [] });
  });
  app.delete(`/oidc/reg/${DEVICE_ID}`, (req, res) => {
    fake.deletions.push(req.headers.authorization);
    fake.hasDeviceClient = false;
    res.status(204).end();
  });
  return fake;
}

let db: TestDb;
let dcr: FakeDcr;
let host: AuthHost;
let ethos: Server;
let appUrl: string;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await closeTestDb(db);
});

beforeEach(async () => {
  vi.stubEnv('OIDC_ISSUER', '');
  vi.stubEnv('OIDC_CLIENT_ID', '');
  vi.stubEnv('OIDC_DEVICE_CLIENT_ID', '');
  forgetDeviceClientCheck();
  await resetTestDb(db);
  dcr = await startDcr();
  const app = express();
  ethos = createServer(app);
  appUrl = await listen(ethos);
  // The redirect URI registered with the provider is built from SERVER_URL; the login page from APP_URL.
  vi.stubEnv('APP_URL', appUrl);
  vi.stubEnv('SERVER_URL', appUrl);
  host = await createAuthHost(db, { secret: TEST_SECRET });
  mountSso(app, host);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close(ethos);
  await dcr.close();
});

/**
 * Makes a client on the real host, so pairing rebuilds what sign-in uses.
 *
 * @param [userId] - Who is calling. Nobody by default.
 * @returns The client.
 */
function client(userId: string | null = null) {
  return createClient(db, userId, { authHost: host });
}

/**
 * Builds the setup URL the stand-in provider would hand out.
 *
 * @param [token] - The initial access token. The good one by default.
 * @param [name] - What the provider calls itself.
 * @returns The URL.
 */
function setupUrl(token = TOKEN, name = 'heautou'): string {
  return `${dcr.issuer}#setup=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`;
}

/**
 * Pairs, expecting one error.
 *
 * @param url - The setup URL.
 * @param [userId] - Who is calling. Nobody by default.
 * @returns The error's message and extensions.
 */
async function pairError(url: string, userId: string | null = null) {
  const result = await client(userId).run(PAIR, { url });
  expect(result.errors).toHaveLength(1);
  const [error] = result.errors ?? [];
  return { message: error?.message, ...error?.extensions };
}

/**
 * Creates the instance's admin.
 *
 * @param email - Their address.
 * @returns Their id.
 */
async function makeAdmin(email: string): Promise<string> {
  const id = await createUser(db, email);
  await db.update(dbSchema.users).set({ isAdmin: true }).where(eq(dbSchema.users.id, id));
  return id;
}

describe('setup URLs', () => {
  it('takes the issuer, token and name apart', () => {
    expect(parseSetupUrl('https://id.example.com/oidc#setup=abc&name=heautou')).toEqual({
      issuer: 'https://id.example.com/oidc',
      token: 'abc',
      name: 'heautou',
    });
  });

  it('calls a provider with no name SSO', () => {
    expect(parseSetupUrl('https://id.example.com/oidc/#setup=abc').name).toBe('SSO');
  });

  it('refuses anything that is not a setup URL', () => {
    expect(() => parseSetupUrl('not a url')).toThrow(/not a URL/);
    expect(() => parseSetupUrl('https://id.example.com/oidc')).toThrow(/no setup token/);
    expect(() => parseSetupUrl('ftp://id.example.com/oidc#setup=abc')).toThrow(/https/);
  });
});

describe('pairSso', () => {
  it('registers Ethos and puts the button on the login page without a restart', async () => {
    expect((await client().expectOk(CONFIG)).authConfig.sso).toBeNull();
    expect((await client().expectOk(SETUP)).ssoSetup).toMatchObject({ source: SsoSource.None, canPair: true });

    const data = await client().expectOk(PAIR, { url: setupUrl() });
    expect(data.pairSso).toEqual({ source: SsoSource.Paired, name: 'heautou', canPair: true });

    expect(dcr.registrations).toHaveLength(1);
    const [registration] = dcr.registrations;
    expect(registration?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(registration?.body).toEqual({
      client_name: 'Ethos',
      client_uri: appUrl,
      redirect_uris: [`${appUrl}/api/auth/callback/oidc`],
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });

    expect(await readPairedOidc(db)).toMatchObject({
      issuer: dcr.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      name: 'heautou',
      registrationAccessToken: RAT,
      registrationClientUri: `${dcr.issuer}/reg/${CLIENT_ID}`,
      deviceClientId: null,
    });
    expect((await client().expectOk(CONFIG)).authConfig.sso).toEqual({
      name: 'heautou',
      signInUrl: `${appUrl}${SSO_START_PATH}`,
      deviceClientId: null,
    });

    // The running server's sign-in now goes to the provider, as the new client.
    const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
    expect(start.status).toBe(HttpStatus.Found);
    const authorize = new URL(start.headers.get('location') ?? '');
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${dcr.issuer}/auth`);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
  });

  it('says a used or expired setup URL is spent, and keeps nothing', async () => {
    const error = await pairError(setupUrl('iat-used'));
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.Expired });
    expect(error.message).toMatch(/new one/);
    expect(await readPairedOidc(db)).toBeNull();
    expect(host.oidc()).toBeNull();
  });

  it('passes on why the provider refused the registration', async () => {
    dcr.answer = 'badRedirect';
    const error = await pairError(setupUrl());
    expect(error).toMatchObject({ code: ErrorCode.BadUserInput, reason: PairingFailure.Refused });
    expect(error.message).toMatch(/redirect_uris must use https/);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('says when the provider is rate limiting', async () => {
    dcr.answer = 'rateLimited';
    expect(await pairError(setupUrl())).toMatchObject({
      code: ErrorCode.TooManyRequests,
      reason: PairingFailure.RateLimited,
    });
  });

  it('refuses a discovery document that names another issuer, before sending the token', async () => {
    dcr.claimedIssuer = 'https://evil.example.com/oidc';
    expect(await pairError(setupUrl())).toMatchObject({
      code: ErrorCode.BadUserInput,
      reason: PairingFailure.NotAProvider,
    });
    expect(dcr.registrations).toHaveLength(0);
  });

  it('says when nothing answers at the URL', async () => {
    expect(await pairError('http://127.0.0.1:1/oidc#setup=abc')).toMatchObject({
      reason: PairingFailure.NotAProvider,
    });
  });

  it('says when the provider cannot pair', async () => {
    dcr.canRegister = false;
    expect(await pairError(setupUrl())).toMatchObject({ reason: PairingFailure.NoRegistration });
  });

  it('will not pair over an existing pairing', async () => {
    await client().expectOk(PAIR, { url: setupUrl() });
    expect(await pairError(setupUrl())).toMatchObject({ code: ErrorCode.Conflict });
  });
});

describe('the device client', () => {
  it('is registered with the same token when the provider offers the device flow', async () => {
    dcr.hasDeviceFlow = true;
    await client().expectOk(PAIR, { url: setupUrl() });
    expect(dcr.registrations).toHaveLength(2);
    expect(dcr.registrations[1]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(dcr.registrations[1]?.body).toEqual({
      client_name: 'Ethos devices',
      client_uri: appUrl,
      redirect_uris: [],
      token_endpoint_auth_method: 'none',
      grant_types: [DEVICE_CODE_GRANT, 'refresh_token'],
      response_types: [],
    });
    expect(await readPairedOidc(db)).toMatchObject({
      deviceClientId: DEVICE_ID,
      deviceRegistrationAccessToken: DEVICE_RAT,
      deviceRegistrationClientUri: `${dcr.issuer}/reg/${DEVICE_ID}`,
    });
  });

  it('is told to device apps only once the provider has turned its device flow on', async () => {
    dcr.hasDeviceFlow = true;
    await client().expectOk(PAIR, { url: setupUrl() });
    expect((await client().expectOk(DEVICE_CONFIG)).authConfig.sso.deviceClientId).toBeNull();

    dcr.isDeviceFlowOn = true;
    // The answer is remembered for a while, so reading again does not ask.
    expect((await client().expectOk(DEVICE_CONFIG)).authConfig.sso.deviceClientId).toBeNull();
    expect(dcr.deviceReads).toBe(1);
    forgetDeviceClientCheck();
    expect((await client().expectOk(DEVICE_CONFIG)).authConfig.sso.deviceClientId).toBe(DEVICE_ID);

    // The provider's admin turned it off, which removed it.
    dcr.hasDeviceClient = false;
    forgetDeviceClientCheck();
    expect((await client().expectOk(DEVICE_CONFIG)).authConfig.sso.deviceClientId).toBeNull();
  });

  it('gives way to OIDC_DEVICE_CLIENT_ID', async () => {
    dcr.hasDeviceFlow = true;
    dcr.isDeviceFlowOn = true;
    await client().expectOk(PAIR, { url: setupUrl() });
    vi.stubEnv('OIDC_DEVICE_CLIENT_ID', 'home-assistant');
    expect((await client().expectOk(DEVICE_CONFIG)).authConfig.sso.deviceClientId).toBe('home-assistant');
  });

  it('is not asked for when the provider has no device flow', async () => {
    await client().expectOk(PAIR, { url: setupUrl() });
    expect(dcr.registrations).toHaveLength(1);
    expect((await client().expectOk(DEVICE_CONFIG)).authConfig.sso.deviceClientId).toBeNull();
  });

  it('does not stop pairing when the provider allows the token once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dcr.hasDeviceFlow = true;
    dcr.allowsDeviceClient = false;
    const data = await client().expectOk(PAIR, { url: setupUrl() });
    expect(data.pairSso.source).toBe(SsoSource.Paired);
    expect(await readPairedOidc(db)).toMatchObject({ clientId: CLIENT_ID, deviceClientId: null });
  });

  it('is deleted at the provider on unpairing', async () => {
    dcr.hasDeviceFlow = true;
    await client().expectOk(PAIR, { url: setupUrl() });
    await client().expectOk(UNPAIR);
    expect(dcr.deletions).toEqual([`Bearer ${RAT}`, `Bearer ${DEVICE_RAT}`]);
    expect(dcr.hasDeviceClient).toBe(false);
  });
});

describe('who may pair', () => {
  it('is anyone while there are no accounts', async () => {
    expect((await client().expectOk(SETUP)).ssoSetup.canPair).toBe(true);
  });

  it('is only the admin once anyone has an account', async () => {
    const admin = await makeAdmin('admin@example.com');
    const member = await createUser(db, 'member@example.com');

    expect((await client().expectOk(SETUP)).ssoSetup).toMatchObject({ canPair: false, issuer: null });
    expect((await client(member).expectOk(SETUP)).ssoSetup.canPair).toBe(false);
    expect((await client(admin).expectOk(SETUP)).ssoSetup.canPair).toBe(true);

    expect(await pairError(setupUrl())).toMatchObject({ code: ErrorCode.Forbidden });
    expect(await pairError(setupUrl(), member)).toMatchObject({ code: ErrorCode.Forbidden });
    expect(dcr.registrations).toHaveLength(0);

    await client(admin).expectOk(PAIR, { url: setupUrl() });
    expect((await client(admin).expectOk(SETUP)).ssoSetup).toMatchObject({
      source: SsoSource.Paired,
      issuer: dcr.issuer,
    });
  });

  it('is nobody when the environment names the provider, which wins', async () => {
    vi.stubEnv('OIDC_ISSUER', 'https://env.example.com/oidc');
    vi.stubEnv('OIDC_CLIENT_ID', 'env-client');
    vi.stubEnv('OIDC_NAME', 'Corp SSO');
    const admin = await makeAdmin('admin@example.com');

    expect((await client(admin).expectOk(SETUP)).ssoSetup).toMatchObject({
      source: SsoSource.Env,
      name: 'Corp SSO',
      canPair: false,
    });
    expect((await client(admin).expectOk(CONFIG)).authConfig.sso.name).toBe('Corp SSO');
    expect(await pairError(setupUrl(), admin)).toMatchObject({ code: ErrorCode.Forbidden });
  });

  const TEST_SOURCE = { method: 'test' };

  it('makes the first account better-auth creates the admin, and no other', async () => {
    const internal = (await host.current().$context).internalAdapter;
    const first = await internal.createUser(
      { email: 'first@example.com', name: 'first', emailVerified: true },
      TEST_SOURCE,
    );
    const second = await internal.createUser(
      { email: 'second@example.com', name: 'second', emailVerified: true },
      TEST_SOURCE,
    );
    expect(await isAdmin(db, first.id)).toBe(true);
    expect(await isAdmin(db, second.id)).toBe(false);
  });
});

describe('unpairSso', () => {
  it('deletes the client at the provider and takes the button away', async () => {
    const admin = await makeAdmin('admin@example.com');
    await client(admin).expectOk(PAIR, { url: setupUrl() });
    expect(host.oidc()).not.toBeNull();

    const data = await client(admin).expectOk(UNPAIR);
    expect(data.unpairSso).toEqual({ source: SsoSource.None, name: null });
    expect(dcr.deletions).toEqual([`Bearer ${RAT}`]);
    expect(await readPairedOidc(db)).toBeNull();
    expect(host.oidc()).toBeNull();
    expect((await client(admin).expectOk(CONFIG)).authConfig.sso).toBeNull();

    // With nothing paired, the sign-in route sends the browser back to the login page.
    const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
    expect(new URL(start.headers.get('location') ?? '').searchParams.get('error')).toBe('sso_off');
  });

  it('counts a client the provider already removed as gone', async () => {
    const admin = await makeAdmin('admin@example.com');
    await client(admin).expectOk(PAIR, { url: setupUrl() });
    dcr.deleteStatus = 401;
    await client(admin).expectOk(UNPAIR);
    expect(await readPairedOidc(db)).toBeNull();
  });

  it('forgets the pairing even when the provider will not delete the client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const admin = await makeAdmin('admin@example.com');
    await client(admin).expectOk(PAIR, { url: setupUrl() });
    dcr.deleteStatus = 500;
    await client(admin).expectOk(UNPAIR);
    expect(await readPairedOidc(db)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[auth]'));
  });

  it('is the admin’s once anyone has an account', async () => {
    await client().expectOk(PAIR, { url: setupUrl() });
    const member = await createUser(db, 'member@example.com');
    const result = await client(member).run(UNPAIR);
    expect(result.errors?.[0]?.extensions?.code).toBe(ErrorCode.Forbidden);
    expect(await readPairedOidc(db)).not.toBeNull();
  });
});
