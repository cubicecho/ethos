import * as dbSchema from '@ethos/db/schema';
import { getTableName, is, Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ALL_TABLES, AUTH_TABLES, contextValues, exclude, SERVER_TABLES, scope } from '../../graphql/tenancy.ts';

// The test that fails when someone adds a table and forgets tenancy. `scope` is
// what confines every generated read, update and delete to the caller; a table
// missing from it is readable across tenants, and nothing else in the codebase
// would say so.

/** better-auth's tables and the server's own, which the API never serves. */
const UNSERVED_TABLES = [...AUTH_TABLES, ...SERVER_TABLES];
const UNSERVED_TABLE_NAMES = new Set<string>(UNSERVED_TABLES);

/** The tables the API serves. */
const tableKeys = Object.entries(dbSchema)
  .filter(([key, value]) => is(value, Table) && UNSERVED_TABLE_NAMES.has(key) === false)
  .map(([key]) => key);

describe('tenancy configuration', () => {
  it('finds the tables', () => {
    expect(tableKeys.sort()).toEqual(['habitEntries', 'habits', 'users']);
  });

  it('lists every table it knows about', () => {
    // A table left out of ALL_TABLES has no API at all — the opposite failure
    // to a missing scope, and just as silent.
    expect([...ALL_TABLES].sort()).toEqual(tableKeys.sort());
  });

  it('excludes every auth and server table, and finds each one in the schema', () => {
    expect(exclude.tables).toEqual(UNSERVED_TABLES);
    const found = Object.entries(dbSchema)
      .filter(([key, value]) => is(value, Table) && UNSERVED_TABLE_NAMES.has(key))
      .map(([key]) => key);
    expect(found.sort()).toEqual([...UNSERVED_TABLES].sort());
  });

  it.each(tableKeys)('scopes %s to the caller', (key) => {
    expect(scope[key]).toBeTypeOf('function');
  });

  it.each(tableKeys.filter((key) => key !== 'users'))('stamps userId on %s rather than accepting it', (key) => {
    expect(contextValues[key]?.userId).toBeTypeOf('function');
  });

  it('names every table by its Drizzle key, not its SQL name', () => {
    // scope is keyed by the schema export name; getting this wrong silently
    // scopes nothing, since an unknown key is simply never consulted.
    for (const [key, value] of Object.entries(dbSchema)) {
      if (is(value, Table) === false || UNSERVED_TABLE_NAMES.has(key)) {
        continue;
      }
      expect(Object.keys(scope)).toContain(key);
      expect(getTableName(value)).toBeTypeOf('string');
    }
  });
});
