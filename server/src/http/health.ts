import type { DB } from '@ethos/db';
import { sql } from 'drizzle-orm';
import { version } from '../core/config.ts';
import { errorMessage } from '../core/errors.ts';

/** What `/healthz` answers. */
export interface Health {
  /** Whether Postgres answered a query just now. */
  ok: boolean;
  /** The release this instance is running. */
  version: string;
  /** Why it is not ok. Absent when it is. */
  error?: string;
}

/**
 * Asks Postgres for one row, so "healthy" means a request could be served.
 *
 * A process that is up but cannot reach its database answers every request with
 * an error, and an orchestrator should hear that and stop routing to it.
 *
 * @param db - The database.
 * @returns The report; `ok` is false when the query fails.
 */
export async function checkHealth(db: DB): Promise<Health> {
  try {
    await db.execute(sql`select 1`);
    return { ok: true, version: version() };
  } catch (error) {
    return { ok: false, version: version(), error: errorMessage(error) };
  }
}
