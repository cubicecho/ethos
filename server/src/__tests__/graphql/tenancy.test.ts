import * as dbSchema from '@ethos/db/schema';
import { getTableName, is, Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ALL_TABLES, AUTH_TABLES, contextValues, exclude, scope } from '../../graphql/tenancy.ts';

// The test that fails when someone adds a table and forgets tenancy. `scope` is
// what confines every generated read, update and delete to the caller; a table
// missing from it is readable across tenants, and nothing else in the codebase
// would say so.

const AUTH_TABLE_NAMES = new Set<string>(AUTH_TABLES);

/** The tables the API serves. better-auth's own are excluded from it outright. */
const tableKeys = Object.entries(dbSchema)
  .filter(([key, value]) => is(value, Table) && AUTH_TABLE_NAMES.has(key) === false)
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

  it('excludes every auth table, and finds each one in the schema', () => {
    expect(exclude.tables).toEqual([...AUTH_TABLES]);
    const found = Object.entries(dbSchema)
      .filter(([key, value]) => is(value, Table) && AUTH_TABLE_NAMES.has(key))
      .map(([key]) => key);
    expect(found.sort()).toEqual([...AUTH_TABLES].sort());
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
      if (is(value, Table) === false || AUTH_TABLE_NAMES.has(key)) {
        continue;
      }
      expect(Object.keys(scope)).toContain(key);
      expect(getTableName(value)).toBeTypeOf('string');
    }
  });
});
