import { describe, expect, it, vi } from 'vitest';
import {
  CannotCreateDatabaseError,
  createDatabase,
  maintenanceTarget,
  prepareDatabase,
  quoteIdentifier,
} from '../create.ts';

// The maintenance connection is a fake: what is under test is what boot sends
// and how it reads the answer, not Postgres's CREATE DATABASE.

const FAST = { firstRetryDelayMs: 1, maxRetryDelayMs: 2, connectTimeoutMs: 1_000 };
const URL = 'postgres://ethos:secret@db.lan:5438/ethos?sslmode=disable';

const coded = (code: string) => Object.assign(new Error(code), { code });

function admin(failure?: unknown) {
  const client = {
    unsafe: vi.fn(async (_query: string) => {
      if (failure !== undefined) {
        throw failure;
      }
      return [];
    }),
    end: vi.fn(async () => {}),
  };
  return { client, open: vi.fn((_url: string) => client) };
}

function flaky(failures: unknown[]) {
  return {
    execute: vi.fn(async () => {
      const failure = failures.shift();
      if (failure !== undefined) {
        throw failure;
      }
      return [];
    }),
  };
}

describe('quoteIdentifier', () => {
  it('quotes a name and doubles the quotes inside it', () => {
    expect(quoteIdentifier('ethos')).toBe('"ethos"');
    expect(quoteIdentifier('My"DB')).toBe('"My""DB"');
  });
});

describe('maintenanceTarget', () => {
  it('keeps the credentials, host and options, and swaps the database for postgres', () => {
    const { database, maintenanceUrl } = maintenanceTarget(URL);
    expect(database).toBe('ethos');
    expect(maintenanceUrl).toBe('postgres://ethos:secret@db.lan:5438/postgres?sslmode=disable');
  });

  it('leaves an escaped database name as written, the way the driver connects to it', () => {
    expect(maintenanceTarget('postgres://u@h/My%20DB').database).toBe('My%20DB');
  });

  it('falls back to the user, as the driver does, when the URL names no database', () => {
    vi.stubEnv('PGDATABASE', '');
    expect(maintenanceTarget('postgres://ethos@h').database).toBe('ethos');
    vi.unstubAllEnvs();
  });

  it('refuses a URL that names neither a database nor a user', () => {
    vi.stubEnv('PGDATABASE', '');
    expect(() => maintenanceTarget('postgres://h')).toThrow(CannotCreateDatabaseError);
    vi.unstubAllEnvs();
  });
});

describe('createDatabase', () => {
  it('creates the named database through the maintenance database, and closes the connection', async () => {
    const { client, open } = admin();
    await expect(createDatabase(URL, open)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('postgres://ethos:secret@db.lan:5438/postgres?sslmode=disable');
    expect(client.unsafe).toHaveBeenCalledWith('create database "ethos"');
    expect(client.end).toHaveBeenCalled();
  });

  it('counts another instance creating it first as done', async () => {
    const { client, open } = admin(coded('42P04'));
    await expect(createDatabase(URL, open)).resolves.toBe(false);
    expect(client.end).toHaveBeenCalled();
  });

  it('explains a role that may not create databases', async () => {
    const { client, open } = admin(coded('42501'));
    await expect(createDatabase(URL, open)).rejects.toThrow(/grant the role CREATEDB/);
    expect(client.end).toHaveBeenCalled();
  });

  it('passes any other failure through', async () => {
    const refused = coded('ECONNREFUSED');
    const { open } = admin(refused);
    await expect(createDatabase(URL, open)).rejects.toBe(refused);
  });
});

describe('prepareDatabase', () => {
  it('touches nothing when the database is there', async () => {
    const db = flaky([]);
    const { open } = admin();
    const log = vi.fn();
    await prepareDatabase(db, URL, FAST, log, open);
    expect(open).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('creates a missing database, says so, then waits for it', async () => {
    const db = flaky([new Error('Failed query', { cause: coded('3D000') })]);
    const { client, open } = admin();
    const log = vi.fn();
    await prepareDatabase(db, URL, FAST, log, open);
    expect(client.unsafe).toHaveBeenCalledWith('create database "ethos"');
    expect(log).toHaveBeenCalledWith('[db] Created database "ethos".');
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('leaves an unreachable server to the caller', async () => {
    const refused = coded('ECONNREFUSED');
    const db = flaky([refused]);
    const { open } = admin();
    await expect(prepareDatabase(db, URL, { ...FAST, connectTimeoutMs: 0 }, () => {}, open)).rejects.toBe(refused);
    expect(open).not.toHaveBeenCalled();
  });
});
