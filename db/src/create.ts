import postgres from 'postgres';
import type { DatabaseSettings } from './defaults.ts';
import { requiresSsl } from './ssl.ts';
import { errorCode, type Queryable, waitForDatabase } from './wait.ts';

/** Postgres's answer when the database a connection names does not exist. */
export const MISSING_DATABASE = '3D000';
/** CREATE DATABASE lost a race with another instance doing the same. */
const ALREADY_EXISTS = '42P04';
/** The role may not create databases. */
const NOT_ALLOWED = '42501';
/** The database every Postgres server has, and the one to connect to while ours is missing. */
const MAINTENANCE_DATABASE = 'postgres';

/** The least boot needs from a connection to the maintenance database. */
export interface AdminClient {
  unsafe: (query: string) => PromiseLike<unknown>;
  end: () => Promise<void>;
}

/** Thrown when the database is missing and this role may not create it; its message is the whole explanation. */
export class CannotCreateDatabaseError extends Error {
  override name = 'CannotCreateDatabaseError';
}

/**
 * Quotes a name as a SQL identifier, doubling any quote inside it.
 *
 * @param name - The raw identifier.
 * @returns The identifier, safe to put in a statement.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Splits a connection string into the database it names and the same server's maintenance database.
 *
 * @param url - The connection string.
 * @returns The database name, and a URL for `postgres` with the same credentials and options.
 */
export function maintenanceTarget(url: string): { database: string; maintenanceUrl: string } {
  const parsed = new URL(url);
  // Read the name the way postgres-js does: the path undecoded, else PGDATABASE, else the user.
  const database = parsed.pathname.slice(1) || process.env.PGDATABASE || decodeURIComponent(parsed.username);
  if (database === '') {
    throw new CannotCreateDatabaseError(
      'DATABASE_URL names neither a database nor a user, so there is nothing to create.',
    );
  }
  parsed.pathname = `/${MAINTENANCE_DATABASE}`;
  return { database, maintenanceUrl: parsed.toString() };
}

/**
 * Opens one connection to `url`, with TLS decided the way the app's own pool decides it.
 *
 * @param url - The connection string.
 * @returns A client the caller must end.
 */
function connect(url: string): AdminClient {
  const isProduction = process.env.NODE_ENV === 'production';
  return postgres(url, { max: 1, onnotice: () => {}, ...(isProduction && requiresSsl(url) ? { ssl: 'require' } : {}) });
}

/**
 * Creates the database `url` names, through the same server's maintenance database.
 *
 * Another instance creating it first counts as success.
 *
 * @param url - The connection string whose database is missing.
 * @param [open] - Opens the maintenance connection; tests replace it.
 * @returns true when this call created it, false when someone else got there first.
 */
export async function createDatabase(url: string, open: (url: string) => AdminClient = connect): Promise<boolean> {
  const { database, maintenanceUrl } = maintenanceTarget(url);
  const client = open(maintenanceUrl);
  try {
    await client.unsafe(`create database ${quoteIdentifier(database)}`);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === ALREADY_EXISTS) {
      return false;
    }
    if (code === NOT_ALLOWED) {
      throw new CannotCreateDatabaseError(
        `Database "${database}" does not exist, and this role may not create it. Create it, or grant the role CREATEDB.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Waits for Postgres, creating the database first when the server is up but the database is not there.
 *
 * @param db - The app's client, which names the database.
 * @param url - The connection string `db` was built from.
 * @param [overrides] - Settings that replace the defaults while waiting.
 * @param [log] - Where retries and the creation are reported.
 * @param [open] - Opens the maintenance connection; tests replace it.
 */
export async function prepareDatabase(
  db: Queryable,
  url: string,
  overrides: Partial<DatabaseSettings> = {},
  log: (message: string) => void = console.log,
  open?: (url: string) => AdminClient,
): Promise<void> {
  try {
    await waitForDatabase(db, overrides, log);
  } catch (error) {
    if (errorCode(error) !== MISSING_DATABASE) {
      throw error;
    }
    const created = await createDatabase(url, open);
    if (created) {
      log(`[db] Created database "${maintenanceTarget(url).database}".`);
    }
    await waitForDatabase(db, overrides, log);
  }
}
