import * as dbSchema from '@ethos/db/schema';
import { getTableName, is, Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ALL_TABLES, contextValues, scope } from '../graphql/tenancy.ts';

// The test that fails when someone adds a table and forgets tenancy. `scope` is
// what confines every generated read, update and delete to the caller; a table
// missing from it is readable across tenants, and nothing else in the codebase
// would say so.

const tableKeys = Object.entries(dbSchema)
  .filter(([, value]) => is(value, Table))
  .map(([key]) => key);

describe('tenancy configuration', () => {
  it('finds the tables', () => {
    expect(tableKeys.sort()).toEqual(['habitEntries', 'habits', 'users']);
  });

  it('lists every table it knows about', () => {
    // ALL_TABLES is what build-schema.ts generates fields for, so a table left
    // out of it has no API at all — the opposite failure to a missing scope,
    // and just as silent.
    expect([...ALL_TABLES].sort()).toEqual(tableKeys.sort());
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
      if (!is(value, Table)) continue;
      expect(Object.keys(scope)).toContain(key);
      expect(getTableName(value)).toBeTypeOf('string');
    }
  });
});
