import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAuthHost } from '../../auth/auth-host.ts';
import { ErrorCode } from '../../core/errors.ts';
import { HttpStatus } from '../../core/wire.ts';
import { MCP_NAME } from '../../graphql/mcp.ts';
import { createApp } from '../../http/app.ts';
import {
  closeTestDb,
  createClient,
  createSessionToken,
  createTestAuth,
  createTestDb,
  createUser,
  portOf,
  type TestDb,
} from '../helpers.ts';

// /mcp over a real socket, as an MCP client would call it. What is asserted is
// that an agent meets the same caller and the same row scope a browser does.

const PROTOCOL_VERSION = '2025-03-26';

let db: TestDb;
let on: Server;
let off: Server;
let aliceToken: string;

/** Where `server` serves /mcp, once it is listening. */
async function listening(server: Server): Promise<string> {
  if (server.listening === false) {
    await new Promise<void>((resolve) => server.once('listening', resolve));
  }
  return `http://127.0.0.1:${portOf(server)}/mcp`;
}

let onUrl: string;
let offUrl: string;

beforeAll(async () => {
  db = await createTestDb();
  const aliceId = await createUser(db, 'alice@example.com');
  const bobId = await createUser(db, 'bob@example.com');
  const create = 'mutation ($values: CreateHabitInput!) { createHabit(values: $values) { id } }';
  await createClient(db, aliceId).expectOk(create, { values: { name: 'Read' } });
  await createClient(db, bobId).expectOk(create, { values: { name: 'Run' } });
  const { auth } = createTestAuth(db);
  aliceToken = await createSessionToken(auth, aliceId);
  on = (await createApp({ db, authHost: fixedAuthHost(auth), mcp: true })).listen(0);
  off = (await createApp({ db, authHost: fixedAuthHost(auth) })).listen(0);
  onUrl = await listening(on);
  offUrl = await listening(off);
});

afterAll(async () => {
  await Promise.all([on, off].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await closeTestDb(db);
});

/** A JSON-RPC response body, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own call asked for
type AnyBody = any;

const rpc = (url: string, method: string, params: unknown, authorization?: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const call = async (method: string, params: unknown, authorization?: string): Promise<AnyBody> =>
  (await rpc(onUrl, method, params, authorization)).json();

const toolNames = async (): Promise<string[]> =>
  (await call('tools/list', {})).result.tools.map((tool: { name: string }) => tool.name);

describe('/mcp', () => {
  it('is a 404 of its own, not the web client, when switched off', async () => {
    const response = await rpc(offUrl, 'tools/list', {});
    expect(response.status).toBe(HttpStatus.NotFound);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('says who it is', async () => {
    const body = await call('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(body.result.serverInfo.name).toBe(MCP_NAME);
  });

  it('offers the queries and no mutation', async () => {
    const names = await toolNames();
    expect(names).toContain('habits');
    expect(names.filter((name) => /^(create|update|delete|mark|clear|request|verify|sign)/.test(name))).toEqual([]);
  });

  it('offers no query that answers with session tokens', async () => {
    const names = await toolNames();
    expect(names.filter((name) => /session/i.test(name))).toEqual([]);
  });

  it("returns the caller's habits and nobody else's", async () => {
    const body = await call('tools/call', { name: 'habits', arguments: {} }, `Bearer ${aliceToken}`);
    const text = JSON.stringify(body.result);
    expect(body.result.isError ?? false).toBe(false);
    expect(text).toContain('Read');
    expect(text).not.toContain('Run');
  });

  it('refuses a call with no session', async () => {
    const body = await call('tools/call', { name: 'habits', arguments: {} });
    const text = JSON.stringify(body);
    expect(text).toContain(ErrorCode.Unauthenticated);
    expect(text).not.toContain('Read');
  });
});
