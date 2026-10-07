import * as dbSchema from '@ethos/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import { assertTargetsFitPeriods, describeCadenceLimit, maxTargetFor } from '../../habits/cadence.ts';
import { createTestDb, createUser, type TestDb } from '../helpers.ts';

let db: TestDb;
let mine: string;
let theirs: string;

beforeEach(async () => {
  db = await createTestDb();
  mine = await createUser(db, 'mine@example.com');
  theirs = await createUser(db, 'theirs@example.com');
});

describe('maxTargetFor', () => {
  it('lets a day be kept once', () => {
    expect(maxTargetFor('day')).toBe(1);
  });

  it('gives a week its seven days', () => {
    expect(maxTargetFor('week')).toBe(7);
  });

  it('measures a month by February, not by the month we happen to be in', () => {
    // 28, never 30 or 31: a cadence satisfiable in August and impossible in
    // February fails once a year for reasons nobody wrote down.
    expect(maxTargetFor('month')).toBe(28);
  });
});

describe('describeCadenceLimit', () => {
  it('says what a daily habit is', () => {
    expect(describeCadenceLimit('day')).toBe('A daily habit is kept once a day.');
  });

  it('names the ceiling it is describing', () => {
    expect(describeCadenceLimit('week')).toContain('7');
    expect(describeCadenceLimit('month')).toContain('28');
  });
});

describe('assertTargetsFitPeriods', () => {
  const insert = (userId: string, values: Partial<dbSchema.NewHabit>) =>
    db.insert(dbSchema.habits).values({ userId, name: 'A habit', ...values });

  it('passes a cadence a period could give', async () => {
    await insert(mine, { period: 'week', targetCount: 7 });
    await insert(mine, { period: 'month', targetCount: 28 });
    await expect(assertTargetsFitPeriods(db, mine)).resolves.toBeUndefined();
  });

  it('names the offending habit, so the reader knows which one to fix', async () => {
    await insert(mine, { name: 'Read', period: 'week', targetCount: 8 });
    await expect(assertTargetsFitPeriods(db, mine)).rejects.toMatchObject({
      message: expect.stringContaining('Read'),
      extensions: { code: ErrorCode.BadUserInput },
    });
  });

  it('looks only at the caller’s own habits', async () => {
    // Otherwise one user's impossible cadence would block every write in the
    // app, for everybody.
    await insert(theirs, { period: 'month', targetCount: 31 });
    await expect(assertTargetsFitPeriods(db, mine)).resolves.toBeUndefined();
    await expect(assertTargetsFitPeriods(db, theirs)).rejects.toThrow();
  });
});
