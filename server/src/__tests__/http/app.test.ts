import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../auth/rate-limit.ts';
import { signToken } from '../../auth/resolvers.ts';
import { version } from '../../core/config.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { createApp } from '../../http/app.ts';
import { createTestDb, createUser, portOf } from '../helpers.ts';

// The app production runs, against PGlite, over a real socket. Everything else
// calls `graphql()` in-process, so this is the one place routing order and the
// Authorization header are exercised together.

const INDEX = '<!doctype html><title>Ethos</title>';
const HABITS = '{ habits { id } }';
const EMAIL = 'alice@example.com';
/** Past `HTTP_DEFAULTS.bodyLimit`, which is 1 MiB. */
const OVERSIZED_BODY_BYTES = 1_100_000;
const APP_ORIGIN = 'http://ethos.test';
const OTHER_ORIGIN = 'http://elsewhere.test';

let staticDir: string;
let server: Server;
let base: string;
let aliceId: string;

beforeAll(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'ethos-app-'));
  writeFileSync(join(staticDir, 'index.html'), INDEX);
  const db = await createTestDb();
  aliceId = await createUser(db, EMAIL);
  const app = await createApp({ db, staticDir, allowedOrigins: [APP_ORIGIN] });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(staticDir, { recursive: true, force: true });
});

const post = (query: string, authorization?: string) =>
  fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization === undefined ? {} : { authorization }) },
    body: JSON.stringify({ query }),
  });

/** A GraphQL response body, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own query asked for
type AnyBody = any;

const ask = async (query: string, authorization?: string): Promise<AnyBody> =>
  (await post(query, authorization)).json();

describe('app', () => {
  it('answers /healthz ahead of the web client', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.json()).toEqual({ ok: true, version: version() });
  });

  it('refuses a query with no session', async () => {
    const body = await ask(HABITS);
    expect(body.errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
  });

  it('refuses a token it did not sign', async () => {
    const body = await ask(HABITS, 'Bearer not-a-token');
    expect(body.errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
  });

  it('reads the caller from a Bearer token', async () => {
    const body = await ask(HABITS, `Bearer ${signToken(aliceId)}`);
    expect(body.errors).toBeUndefined();
    expect(body.data.habits).toEqual([]);
  });

  it('lets the app origin read a response', async () => {
    const response = await fetch(`${base}/healthz`, { headers: { origin: APP_ORIGIN } });
    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
  });

  it('gives any other origin no permission to read one', async () => {
    const response = await fetch(`${base}/healthz`, { headers: { origin: OTHER_ORIGIN } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a query that costs too much, before running it', async () => {
    const { maxPageSize } = OPERATION_LIMIT_DEFAULTS;
    const response = await post(
      `{ habits(limit: ${maxPageSize}) { entries(limit: ${maxPageSize}) { id } } }`,
      `Bearer ${signToken(aliceId)}`,
    );
    const body: AnyBody = await response.json();
    expect(response.status).toBe(HttpStatus.BadRequest);
    expect(body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
    expect(body.data).toBeUndefined();
  });

  it('refuses a query nested too deep', async () => {
    // One row at every level, so it is the depth and not the cost that is over.
    const levels = Array.from({ length: OPERATION_LIMIT_DEFAULTS.maxDepth }, (_, level) =>
      level % 2 === 0 ? 'entries(limit: 1)' : 'habit',
    );
    const body = await ask(`{ habits(limit: 1) { ${levels.join(' { ')} { id ${'} '.repeat(levels.length)}} }`);
    expect(body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
    expect(body.errors[0].message).toContain('levels deep');
  });

  it('refuses a body over the limit with a 413', async () => {
    const response = await post(`{ habits { id } } # ${'x'.repeat(OVERSIZED_BODY_BYTES)}`);
    expect(response.status).toBe(HttpStatus.PayloadTooLarge);
  });

  it('serves the web client for a path it does not know', async () => {
    const response = await fetch(`${base}/habits/some-id`);
    expect(response.status).toBe(HttpStatus.Ok);
    expect(await response.text()).toBe(INDEX);
  });
});

describe('app whose database does not answer', () => {
  it('reports itself unhealthy with a 503', async () => {
    const db = await createTestDb();
    const down = Object.create(db, { execute: { value: () => Promise.reject(new Error('connection refused')) } });
    const app = await createApp({ db: down });
    const sick = app.listen(0);
    await new Promise<void>((resolve) => sick.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${portOf(sick)}/healthz`);
    await new Promise<void>((resolve) => sick.close(() => resolve()));
    expect(response.status).toBe(HttpStatus.ServiceUnavailable);
    expect(await response.json()).toEqual({ ok: false, version: version(), error: 'connection refused' });
  });
});

describe('app behind a proxy', () => {
  const REQUEST = 'mutation ($email: String!) { requestMagicLink(email: $email) { ok } }';
  let addresses = 0;

  /** Asks for a sign-in link for a fresh address, as the proxy would forward it for `client`. */
  async function requestLinkFrom(origin: string, client: string): Promise<AnyBody> {
    const response = await fetch(`${origin}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
      body: JSON.stringify({ query: REQUEST, variables: { email: `proxied${++addresses}@example.com` } }),
    });
    return response.json();
  }

  async function served(trustProxy: number | false): Promise<{ origin: string; close: () => Promise<void> }> {
    const limiter = createRateLimiter({ maxAttempts: 1 });
    const app = await createApp({ db: await createTestDb(), limiter, trustProxy });
    const proxied = app.listen(0);
    await new Promise<void>((resolve) => proxied.once('listening', resolve));
    return {
      origin: `http://127.0.0.1:${portOf(proxied)}`,
      close: () => new Promise<void>((resolve) => proxied.close(() => resolve())),
    };
  }

  it('counts each forwarded client separately when it trusts the proxy', async () => {
    const { origin, close } = await served(1);
    const first = await requestLinkFrom(origin, '203.0.113.1');
    const second = await requestLinkFrom(origin, '203.0.113.2');
    const again = await requestLinkFrom(origin, '203.0.113.1');
    await close();
    expect(first.errors).toBeUndefined();
    expect(second.errors).toBeUndefined();
    expect(again.errors[0].extensions.code).toBe(ErrorCode.TooManyRequests);
  });

  it('ignores a forwarded address it was not told to trust', async () => {
    const { origin, close } = await served(false);
    const first = await requestLinkFrom(origin, '203.0.113.1');
    // A different claimed client, the same socket: one budget, already spent.
    const second = await requestLinkFrom(origin, '203.0.113.2');
    await close();
    expect(first.errors).toBeUndefined();
    expect(second.errors[0].extensions.code).toBe(ErrorCode.TooManyRequests);
  });
});

describe('app without a web client', () => {
  it('answers 404 for a path it does not know', async () => {
    const app = await createApp({ db: await createTestDb() });
    const bare = app.listen(0);
    await new Promise<void>((resolve) => bare.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${portOf(bare)}/habits/some-id`);
    await new Promise<void>((resolve) => bare.close(() => resolve()));
    expect(response.status).toBe(HttpStatus.NotFound);
  });
});
