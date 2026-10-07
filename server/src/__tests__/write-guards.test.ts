import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { assertForeignKeysOwned, writtenRows } from '../resolvers/write-guards.ts';
import { createClient, createTestDb, createUser, type TestClient, type TestDb } from './helpers.ts';

// `scope` confines reads, updates and deletes, but it cannot reach a plain
// insert, and it says nothing about the rows a foreign key points at. These are
// the holes that leaves.

const CREATE = `mutation ($values: CreateHabitInput!) { createHabit(values: $values) { id name period targetCount } }`;

let db: TestDb;
let mine: TestClient;
let theirs: TestClient;
let myUserId: string;
let theirUserId: string;
let theirHabitId: string;

beforeEach(async () => {
  db = await createTestDb();
  myUserId = await createUser(db, 'mine@example.com');
  theirUserId = await createUser(db, 'theirs@example.com');
  mine = createClient(db, myUserId);
  theirs = createClient(db, theirUserId);
  theirHabitId = (await theirs.expectOk(CREATE, { values: { name: 'Theirs' } })).createHabit.id;
});

describe('writes reserved to a hand-written mutation', () => {
  it('generates no CRUD for habit entries at all', async () => {
    // Not a runtime guard but a missing field: `features` in tenancy.ts turns
    // the generated writes off, so the only way to record a day is markHabit.
    const error = await mine.expectError(
      `mutation ($h: UUID!) { createHabitEntry(values: { habitId: $h, day: "2026-09-17" }) { id } }`,
      { h: theirHabitId },
    );
    expect(error.message).toContain('createHabitEntry');
    expect(await db.select().from(dbSchema.habitEntries)).toHaveLength(0);
  });

  it.each(['updateHabitEntry', 'updateHabitEntries', 'deleteHabitEntries'])('generates no %s either', async (field) => {
    const error = await mine.expectError(`mutation { ${field}(where: {}) { id } }`);
    expect(error.message).toContain(field);
  });
});

describe('foreign keys a caller states', () => {
  // The generated writes onto habit_entries are off, so the hook that checks
  // this has nothing to run against through the API. It is still what would
  // stand between a caller and someone else's habit the day they are turned
  // back on, so it is tested where it lives.
  it('accepts an id the caller owns', async () => {
    const habitId = (await mine.expectOk(CREATE, { values: { name: 'Mine' } })).createHabit.id;
    await expect(
      assertForeignKeysOwned(
        db,
        myUserId,
        [{ habitId }],
        [{ key: 'habitId', entity: 'Habit', parent: dbSchema.habits }],
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses an id belonging to someone else, as NOT_FOUND rather than FORBIDDEN', async () => {
    // "You may not touch this" would confirm the row exists, which is itself
    // something the caller is not entitled to know.
    await expect(
      assertForeignKeysOwned(
        db,
        myUserId,
        [{ habitId: theirHabitId }],
        [{ key: 'habitId', entity: 'Habit', parent: dbSchema.habits }],
      ),
    ).rejects.toMatchObject({ message: 'Habit not found', extensions: { code: 'NOT_FOUND' } });
  });

  it('checks every row of a batch, not just the first', async () => {
    const habitId = (await mine.expectOk(CREATE, { values: { name: 'Mine' } })).createHabit.id;
    await expect(
      assertForeignKeysOwned(
        db,
        myUserId,
        [{ habitId }, { habitId: theirHabitId }],
        [{ key: 'habitId', entity: 'Habit', parent: dbSchema.habits }],
      ),
    ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });
});

describe('writtenRows', () => {
  it('reads the rows out of each shape a mutation can carry them in', () => {
    expect(writtenRows({ values: { name: 'One' } })).toEqual([{ name: 'One' }]);
    expect(writtenRows({ values: [{ name: 'One' }, { name: 'Two' }] })).toEqual([{ name: 'One' }, { name: 'Two' }]);
    expect(writtenRows({ set: { name: 'One' } })).toEqual([{ name: 'One' }]);
    expect(writtenRows({ updates: [{ set: { name: 'One' } }, { set: { name: 'Two' } }] })).toEqual([
      { name: 'One' },
      { name: 'Two' },
    ]);
  });

  it('finds nothing to check in a delete', () => {
    expect(writtenRows({})).toEqual([]);
  });
});

describe('cadence, however the write arrives', () => {
  it('refuses a habit asking for more days than its period holds', async () => {
    const error = await mine.expectError(CREATE, { values: { name: 'Too much', period: 'week', targetCount: 8 } });
    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.message).toContain('8 days a week');
    // Only the habit the other user made in beforeEach — this one rolled back.
    expect(await db.select().from(dbSchema.habits)).toHaveLength(1);
  });

  it('refuses an update that moves a habit to a period its target no longer fits', async () => {
    // The write the check has to be an `after` hook to catch: it names only the
    // period, and the target it breaks is already in the row.
    const id = (await mine.expectOk(CREATE, { values: { name: 'Monthly', period: 'month', targetCount: 20 } }))
      .createHabit.id;
    const error = await mine.expectError(
      `mutation ($id: UUID!) { updateHabit(set: { period: "week" }, where: { id: { eq: $id } }) { id period } }`,
      { id },
    );
    expect(error.code).toBe('BAD_USER_INPUT');

    // The throw rolls the transaction back, statement included.
    const [row] = await db.select().from(dbSchema.habits).where(eq(dbSchema.habits.id, id));
    expect(row.period).toBe('month');
    expect(row.targetCount).toBe(20);
  });

  it('accepts a cadence the shortest instance of the period could satisfy', async () => {
    const data = await mine.expectOk(CREATE, { values: { name: 'Monthly', period: 'month', targetCount: 28 } });
    expect(data.createHabit.targetCount).toBe(28);
  });
});

describe('row scope', () => {
  it('hides another user’s habits from every read', async () => {
    expect(await mine.expectOk(`query { habits { id } habitEntries { id } }`)).toEqual({
      habits: [],
      habitEntries: [],
    });
  });

  it('refuses to update a habit belonging to someone else', async () => {
    const data = await mine.expectOk(
      `mutation ($id: UUID!) { updateHabit(set: { name: "Taken" }, where: { id: { eq: $id } }) { id } }`,
      { id: theirHabitId },
    );
    expect(data.updateHabit).toBeNull();

    const [row] = await db.select().from(dbSchema.habits);
    expect(row.name).toBe('Theirs');
  });

  it('refuses to delete a habit belonging to someone else', async () => {
    const data = await mine.expectOk(`mutation ($id: UUID!) { deleteHabits(where: { id: { eq: $id } }) { id } }`, {
      id: theirHabitId,
    });
    expect(data.deleteHabits).toEqual([]);
    expect(await db.select().from(dbSchema.habits)).toHaveLength(1);
  });

  it('stamps userId from the session rather than accepting it', async () => {
    // The column is not in the input type at all, so stating it is a schema
    // error — ownership is never something a caller says.
    const error = await mine.expectError(CREATE, { values: { name: 'Sneaky', userId: theirUserId } });
    expect(String(error.message)).toContain('userId');
  });
});
