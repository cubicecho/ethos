import * as dbSchema from '@ethos/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, periodBefore } from '../../habits/periods.ts';
import { createClient, createTestDb, createUser, type TestClient, type TestDb } from '../helpers.ts';

// Recording a day, end to end. The pure rules live in streaks.test.ts; what is
// under test here is everything between the request and the row — the day key,
// the skip cap, ownership, and the `Date` scalar the day comes back as.

const CREATE = `mutation ($values: CreateHabitInput!) { createHabit(values: $values) { id name period targetCount } }`;
const MARK = `mutation ($id: ID!, $day: String!, $status: String, $note: String) {
  markHabit(habitId: $id, day: $day, status: $status, note: $note) { id }
}`;
const CLEAR = `mutation ($id: ID!, $day: String!) { clearHabit(habitId: $id, day: $day) { id } }`;
const ENTRIES = `query { habitEntries(orderBy: { day: { direction: asc, priority: 1 } }) { day status note } }`;

// Derived from the real clock rather than pinned: `markHabit` refuses a day
// that has not happened yet, which it can only judge against the day the server
// is actually having.
const today = new Date().toISOString().slice(0, 10);
const yesterday = addDays(today, -1);

let db: TestDb;
let mine: TestClient;
let theirs: TestClient;
let anonymous: TestClient;
let habitId: string;

const createHabit = async (client: TestClient, values: Record<string, unknown>): Promise<string> =>
  (await client.expectOk(CREATE, { values })).createHabit.id;

beforeEach(async () => {
  db = await createTestDb();
  mine = createClient(db, await createUser(db, 'mine@example.com'));
  theirs = createClient(db, await createUser(db, 'theirs@example.com'));
  anonymous = createClient(db, null);
  habitId = await createHabit(mine, { name: 'Read' });
});

describe('markHabit', () => {
  it('records the day it was sent, and hands it back as the same day', async () => {
    await mine.expectOk(MARK, { id: habitId, day: yesterday });
    const data = await mine.expectOk(ENTRIES);
    // The `Date` scalar serializes to `YYYY-MM-DD`, not to an instant: a habit
    // kept at 11pm on Tuesday is a Tuesday wherever it is read from.
    expect(data.habitEntries).toEqual([{ day: yesterday, status: 'done', note: null }]);
  });

  it('stores the day verbatim, with no zone left to shift it', async () => {
    await mine.expectOk(MARK, { id: habitId, day: yesterday });
    const [row] = await db.select().from(dbSchema.habitEntries);
    expect(row.day).toBe(yesterday);
  });

  it('treats the day as the key: marking it twice is marking it once', async () => {
    await mine.expectOk(MARK, { id: habitId, day: today });
    await mine.expectOk(MARK, { id: habitId, day: today });
    expect(await db.select().from(dbSchema.habitEntries)).toHaveLength(1);
  });

  it('rewrites the day rather than adding to it when it changes', async () => {
    await mine.expectOk(MARK, { id: habitId, day: today, note: 'first' });
    await mine.expectOk(MARK, { id: habitId, day: today, status: 'skipped', note: 'second' });
    const data = await mine.expectOk(ENTRIES);
    expect(data.habitEntries).toEqual([{ day: today, status: 'skipped', note: 'second' }]);
  });

  it('answers with the streak the write just made, not the one before it', async () => {
    // The habit is returned from the same request that wrote the entry, and its
    // streak is read through a loader that answered once already.
    const data = await mine.expectOk(
      `mutation ($id: ID!, $day: String!, $today: String!) {
        markHabit(habitId: $id, day: $day) { streak(today: $today) current(today: $today) { done met } }
      }`,
      { id: habitId, day: today, today },
    );
    expect(data.markHabit).toEqual({ streak: 1, current: { done: 1, met: true } });
  });

  it('refuses a day that is not one', async () => {
    const error = await mine.expectError(MARK, { id: habitId, day: 'yesterday' });
    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.message).toContain('Expected YYYY-MM-DD');
  });

  it('refuses a status that is neither done nor skipped', async () => {
    const error = await mine.expectError(MARK, { id: habitId, day: today, status: 'maybe' });
    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.message).toContain('"done" or "skipped"');
  });

  it('allows tomorrow, because somewhere it is already today', async () => {
    await expect(mine.expectOk(MARK, { id: habitId, day: addDays(today, 1) })).resolves.toBeTruthy();
  });

  it('refuses a day no zone on earth has reached', async () => {
    const error = await mine.expectError(MARK, { id: habitId, day: addDays(today, 2) });
    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.message).toBe('That day has not happened yet.');
  });

  it('refuses to record a day against an archived habit', async () => {
    await mine.expectOk(
      `mutation ($id: UUID!) { updateHabit(set: { archivedAt: "2026-01-01T00:00:00Z" }, where: { id: { eq: $id } }) { id } }`,
      { id: habitId },
    );
    const error = await mine.expectError(MARK, { id: habitId, day: today });
    // An archived habit is a record, not a practice — the archive is not a place
    // where history keeps changing.
    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.message).toContain('archived');
  });

  it('refuses another user’s habit as NOT_FOUND', async () => {
    const error = await mine.expectError(MARK, { id: await createHabit(theirs, { name: 'Theirs' }), day: today });
    expect(error.code).toBe('NOT_FOUND');
    expect(await db.select().from(dbSchema.habitEntries)).toHaveLength(0);
  });

  it('refuses a request with no session at all', async () => {
    const error = await anonymous.expectError(MARK, { id: habitId, day: today });
    expect(error.code).toBe('UNAUTHENTICATED');
  });
});

describe('the skip cap', () => {
  // A whole month in the past, so every day in it is a day that has happened
  // and the period holds enough of them to reach the cap.
  const lastMonth = periodBefore('month', today).start;
  let monthly: string;

  beforeEach(async () => {
    monthly = await createHabit(mine, { name: 'Run', period: 'month', targetCount: 10 });
  });

  const skip = (day: string) => mine.run(MARK, { id: monthly, day, status: 'skipped' });

  it('allows a period to be skipped up to the cap', async () => {
    await mine.expectOk(MARK, { id: monthly, day: lastMonth, status: 'skipped' });
    await mine.expectOk(MARK, { id: monthly, day: addDays(lastMonth, 1), status: 'skipped' });
    expect(await db.select().from(dbSchema.habitEntries)).toHaveLength(2);
  });

  it('refuses the one past it, and says what the limit is', async () => {
    await skip(lastMonth);
    await skip(addDays(lastMonth, 1));
    const error = await mine.expectError(MARK, { id: monthly, day: addDays(lastMonth, 2), status: 'skipped' });
    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.message).toContain('The limit is 2.');
  });

  it('lets a period at the cap change its mind about which days it declined', async () => {
    // Counted over the period's other days rather than incremented: rewriting a
    // day that is already a skip is not a new one.
    await skip(lastMonth);
    await skip(addDays(lastMonth, 1));
    await expect(
      mine.expectOk(MARK, { id: monthly, day: lastMonth, status: 'skipped', note: 'ill' }),
    ).resolves.toBeTruthy();
  });

  it('does not count a day kept against the cap', async () => {
    await skip(lastMonth);
    await skip(addDays(lastMonth, 1));
    await expect(mine.expectOk(MARK, { id: monthly, day: addDays(lastMonth, 2) })).resolves.toBeTruthy();
  });

  it('counts the cap per period, not per habit', async () => {
    const twoMonthsBack = periodBefore('month', lastMonth).start;
    await skip(lastMonth);
    await skip(addDays(lastMonth, 1));
    await expect(mine.expectOk(MARK, { id: monthly, day: twoMonthsBack, status: 'skipped' })).resolves.toBeTruthy();
  });
});

describe('clearHabit', () => {
  beforeEach(async () => {
    await mine.expectOk(MARK, { id: habitId, day: yesterday });
    await mine.expectOk(MARK, { id: habitId, day: today });
  });

  it('leaves the day untouched rather than missed', async () => {
    await mine.expectOk(CLEAR, { id: habitId, day: today });
    const data = await mine.expectOk(ENTRIES);
    expect(data.habitEntries).toEqual([{ day: yesterday, status: 'done', note: null }]);
  });

  it('is a no-op on a day that was never recorded', async () => {
    await expect(mine.expectOk(CLEAR, { id: habitId, day: addDays(today, -30) })).resolves.toBeTruthy();
    expect(await db.select().from(dbSchema.habitEntries)).toHaveLength(2);
  });

  it('refuses a day that is not one', async () => {
    expect((await mine.expectError(CLEAR, { id: habitId, day: '2026-02-31' })).code).toBe('BAD_USER_INPUT');
  });

  it('refuses another user’s habit as NOT_FOUND', async () => {
    const error = await theirs.expectError(CLEAR, { id: habitId, day: today });
    expect(error.code).toBe('NOT_FOUND');
    expect(await db.select().from(dbSchema.habitEntries)).toHaveLength(2);
  });

  it('answers with the streak the clear just ended', async () => {
    const data = await mine.expectOk(
      `mutation ($id: ID!, $day: String!, $today: String!) {
        clearHabit(habitId: $id, day: $day) { streak(today: $today) }
      }`,
      { id: habitId, day: today, today },
    );
    // Yesterday is still kept, and today is back to untouched — which is not a
    // failure yet, so the run through yesterday stands.
    expect(data.clearHabit.streak).toBe(1);
  });
});

describe('the fields the grid reads', () => {
  const HISTORY = `query ($id: UUID!, $today: String!, $periods: Int!) {
    habit(where: { id: { eq: $id } }) { history(periods: $periods, today: $today) { start end } }
  }`;

  beforeEach(async () => {
    await mine.expectOk(MARK, { id: habitId, day: today });
  });

  it('returns the periods asked for, oldest first', async () => {
    const data = await mine.expectOk(HISTORY, { id: habitId, today, periods: 3 });
    const [first, second, third] = data.habit.history;
    expect(first.end).toBe(second.start);
    expect(second.end).toBe(third.start);
    expect(third.start).toBe(today);
  });

  it('clamps an absurd window rather than answering with an error', async () => {
    // A grid asking for a thousand periods is a client bug, and 52 of them is
    // more useful than a failed screen.
    const data = await mine.expectOk(HISTORY, { id: habitId, today, periods: 1000 });
    expect(data.habit.history).toHaveLength(52);
    expect((await mine.expectOk(HISTORY, { id: habitId, today, periods: 0 })).habit.history).toHaveLength(1);
  });

  it('refuses a `today` that is not a day', async () => {
    const error = await mine.expectError(HISTORY, { id: habitId, today: 'now', periods: 3 });
    expect(error.code).toBe('BAD_USER_INPUT');
  });

  it('falls back to the server’s own day when the client does not send one', async () => {
    // Only ever a fallback — the client sends its own — but it must not throw.
    const data = await mine.expectOk(
      `query ($id: UUID!) { habit(where: { id: { eq: $id } }) { streak longestStreak current { start met } history { start } } }`,
      { id: habitId },
    );
    expect(data.habit.current.start).toBe(today);
    expect(data.habit.history).toHaveLength(12);
  });

  it('counts the current period over the caller’s own entries only', async () => {
    const data = await mine.expectOk(
      `query ($id: UUID!, $today: String!) {
        habit(where: { id: { eq: $id } }) {
          streak(today: $today)
          longestStreak(today: $today)
          current(today: $today) { start end done skipped target effectiveTarget met rate }
        }
      }`,
      { id: habitId, today },
    );
    expect(data.habit).toEqual({
      streak: 1,
      longestStreak: 1,
      current: {
        start: today,
        end: addDays(today, 1),
        done: 1,
        skipped: 0,
        target: 1,
        effectiveTarget: 1,
        met: true,
        rate: 1,
      },
    });
  });

  it('hides another user’s entries from the relation as well as the list', async () => {
    const data = await theirs.expectOk(`query { habits { id entries { day } } habitEntries { day } }`);
    expect(data).toEqual({ habits: [], habitEntries: [] });
  });
});
