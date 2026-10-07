import { type DocumentNode, type GraphQLSchema, Kind, parse } from 'graphql';
import { beforeAll, describe, expect, it } from 'vitest';
// The documents the web client really sends, as its codegen wrote them. A copy
// kept here would go on passing after the client changed.
import * as appDocuments from '../../../../app/src/__generated__/graphql.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { ErrorCode } from '../../core/errors.ts';
import { createSchema } from '../../graphql/build-schema.ts';
import { assertWithinLimits } from '../../graphql/operation-limits.ts';
import { createClient, createTestDb, createUser, type TestDb } from '../helpers.ts';

const { maxAliases, maxDepth, maxPageSize } = OPERATION_LIMIT_DEFAULTS;

let db: TestDb;
let schema: GraphQLSchema;

beforeAll(async () => {
  db = await createTestDb();
  schema = createSchema(db).schema;
});

/** The `extensions.code` `assertWithinLimits` throws for `query`, or undefined when it passes. */
function refusalOf(query: string): unknown {
  try {
    assertWithinLimits({ schema, document: parse(query) }, OPERATION_LIMIT_DEFAULTS);
    return undefined;
  } catch (error) {
    return error instanceof Error && 'extensions' in error ? (error.extensions as { code?: unknown }).code : error;
  }
}

/**
 * `{ habits { entries { habit { entries { … id } } } } }`, `levels` fields deep.
 * Every list asks for one row, so only the depth is over any limit.
 */
function nested(levels: number): string {
  const fields = Array.from({ length: levels - 2 }, (_, level) => (level % 2 === 0 ? 'entries(limit: 1)' : 'habit'));
  return `{ habits(limit: 1) { ${fields.join(' { ')} { id ${'} '.repeat(fields.length)}} }`;
}

const isOperation = (value: unknown): value is DocumentNode =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === Kind.DOCUMENT &&
  'definitions' in value &&
  Array.isArray(value.definitions) &&
  value.definitions.some((definition) => definition.kind === Kind.OPERATION_DEFINITION);

/** A value for every variable the app's documents declare. A new one fails here until it is added. */
const VARIABLES = {
  today: '2026-10-06',
  day: '2026-10-06',
  id: '00000000-0000-4000-8000-000000000000',
  habitId: '00000000-0000-4000-8000-000000000000',
  values: { name: 'Run' },
  set: { name: 'Run' },
  status: 'done',
  note: null,
  email: 'someone@example.com',
  token: 'a-token',
};

const sent = Object.entries(appDocuments).filter((entry): entry is [string, DocumentNode] => isOperation(entry[1]));

describe('assertWithinLimits', () => {
  it('finds the documents the app sends', () => {
    expect(sent.map(([name]) => name)).toContain('HabitsDocument');
  });

  it.each(sent)('lets the app send %s', (_name, document) => {
    expect(() =>
      assertWithinLimits({ schema, document, variables: VARIABLES }, OPERATION_LIMIT_DEFAULTS),
    ).not.toThrow();
  });

  it('leaves a missing variable for execution to report', () => {
    expect(refusalOf('query ($today: String!) { habits { streak(today: $today) } }')).toBeUndefined();
  });

  it('allows a query at the depth limit and refuses one level more', () => {
    expect(refusalOf(nested(maxDepth))).toBeUndefined();
    expect(refusalOf(nested(maxDepth + 1))).toBe(ErrorCode.QueryTooComplex);
  });

  it('allows the alias limit and refuses one more', () => {
    const aliased = (count: number) =>
      `{ ${Array.from({ length: count }, (_, index) => `a${index}: users { id }`).join(' ')} }`;
    expect(refusalOf(aliased(maxAliases))).toBeUndefined();
    expect(refusalOf(aliased(maxAliases + 1))).toBe(ErrorCode.QueryTooComplex);
  });

  it('refuses a query that could return more than the cost limit', () => {
    // Two full pages multiplied: far more rows than one request may ask for.
    const query = `{ habits(limit: ${maxPageSize}) { entries(limit: ${maxPageSize}) { id } } }`;
    expect(refusalOf(query)).toBe(ErrorCode.QueryTooComplex);
  });
});

describe('page size', () => {
  it('refuses a limit over the maximum', async () => {
    const client = createClient(db, await createUser(db, 'pager@example.com'));
    const error = await client.expectError(`{ habits(limit: ${maxPageSize + 1}) { id } }`);
    expect(error.code).toBe('DRIZZLE_LIMIT_EXCEEDED');
  });

  it('accepts the maximum itself', async () => {
    const client = createClient(db, await createUser(db, 'pager2@example.com'));
    const data = await client.expectOk(`{ habits(limit: ${maxPageSize}) { id } }`);
    expect(data.habits).toEqual([]);
  });
});
