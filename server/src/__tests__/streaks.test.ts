import { describe, expect, it } from 'vitest';
import { periodOf } from '../habits/periods.ts';
import {
  currentStreak,
  type EntryLike,
  type HabitLike,
  longestStreak,
  MAX_SKIPS_PER_PERIOD,
  tallyPeriod,
  tallyRecent,
} from '../habits/streaks.ts';

// The three rules from streaks.ts, one describe block each. Everything the app
// reports about a habit is one of them applied, so a change that quietly
// redefines "kept" fails here rather than in a screenshot six weeks later.

const daily: HabitLike = { period: 'day', targetCount: 1 };
const weekly: HabitLike = { period: 'week', targetCount: 3 };
const monthly: HabitLike = { period: 'month', targetCount: 5 };

const done = (...days: string[]): EntryLike[] => days.map((day) => ({ day, status: 'done' }));
const skipped = (...days: string[]): EntryLike[] => days.map((day) => ({ day, status: 'skipped' }));

// A Thursday, mid-week and mid-month, so no assertion below is accidentally
// sitting on a boundary.
const TODAY = '2026-09-17';

describe('tallyPeriod', () => {
  it('counts the days inside the period and ignores the ones outside it', () => {
    const entries = [...done('2026-09-13', '2026-09-15', '2026-09-16'), ...done('2026-09-21')];
    const tally = tallyPeriod(weekly, entries, periodOf('week', TODAY));
    // The 13th is the Sunday before and the 21st the Monday after: `end` is
    // exclusive, so neither belongs to this week.
    expect(tally).toMatchObject({ start: '2026-09-14', end: '2026-09-21', done: 2, skipped: 0, target: 3 });
  });

  it('reads a period that met its target as kept, at a rate of 1', () => {
    const tally = tallyPeriod(weekly, done('2026-09-14', '2026-09-15', '2026-09-16'), periodOf('week', TODAY));
    expect(tally).toMatchObject({ done: 3, effectiveTarget: 3, met: true, rate: 1 });
  });

  it('clamps the rate at 1 when more days were kept than asked for', () => {
    const tally = tallyPeriod(
      weekly,
      done('2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'),
      periodOf('week', TODAY),
    );
    expect(tally.rate).toBe(1);
  });

  it('reads a period short of its target as missed', () => {
    const tally = tallyPeriod(weekly, done('2026-09-14'), periodOf('week', TODAY));
    expect(tally).toMatchObject({ done: 1, effectiveTarget: 3, met: false });
    expect(tally.rate).toBeCloseTo(1 / 3);
  });
});

describe('rule 1: a skip is not a miss', () => {
  it('takes a skipped day off what the period asked for', () => {
    // "3× a week" with one day declined asks for two, and two days kept meet it.
    const entries = [...done('2026-09-14', '2026-09-15'), ...skipped('2026-09-16')];
    expect(tallyPeriod(weekly, entries, periodOf('week', TODAY))).toMatchObject({
      done: 2,
      skipped: 1,
      target: 3,
      effectiveTarget: 2,
      met: true,
      rate: 1,
    });
  });

  it('never counts a skip as a day kept', () => {
    const tally = tallyPeriod(weekly, skipped('2026-09-14'), periodOf('week', TODAY));
    expect(tally.done).toBe(0);
    expect(tally.effectiveTarget).toBe(2);
    expect(tally.met).toBe(false);
  });

  it('reads a period skipped down to owing nothing as kept', () => {
    const tally = tallyPeriod(daily, skipped('2026-09-17'), periodOf('day', TODAY));
    expect(tally).toMatchObject({ effectiveTarget: 0, met: true, rate: 1 });
  });

  it('floors the effective target at zero rather than going negative', () => {
    // The cap on skips is the resolver's (see habits/resolvers.ts) — this module
    // counts whatever rows it is handed, and must not produce a negative target
    // or a rate above 1 if one ever gets past it.
    expect(MAX_SKIPS_PER_PERIOD).toBe(2);
    const tally = tallyPeriod(daily, skipped('2026-09-14', '2026-09-15', '2026-09-16'), periodOf('week', TODAY));
    expect(tally.effectiveTarget).toBe(0);
    expect(tally.rate).toBe(1);
  });

  it('treats an untouched day as the miss, not the skipped one', () => {
    // 09-16 skipped keeps the run; 09-15 untouched ends it.
    const kept = currentStreak(
      daily,
      [...done('2026-09-14', '2026-09-15', '2026-09-17'), ...skipped('2026-09-16')],
      TODAY,
    );
    expect(kept).toBe(4);
    const broken = currentStreak(daily, done('2026-09-14', '2026-09-16', '2026-09-17'), TODAY);
    expect(broken).toBe(2);
  });
});

describe('rule 2: a streak counts periods, not days', () => {
  it('does not break a weekly habit on the days between its kept ones', () => {
    // Monday, Thursday, Saturday for three weeks running: not one pair of
    // consecutive days in it, and an unbroken three-week streak all the same.
    const entries = done(
      '2026-08-31',
      '2026-09-03',
      '2026-09-05',
      '2026-09-07',
      '2026-09-10',
      '2026-09-12',
      '2026-09-14',
      '2026-09-16',
      '2026-09-17',
    );
    expect(currentStreak(weekly, entries, TODAY)).toBe(3);
  });

  it('counts a daily habit day by day, because for it a period is a day', () => {
    expect(currentStreak(daily, done('2026-09-15', '2026-09-16', '2026-09-17'), TODAY)).toBe(3);
  });

  it('counts months for a monthly habit', () => {
    const entries = done(
      '2026-07-02',
      '2026-07-09',
      '2026-07-16',
      '2026-07-23',
      '2026-07-30',
      '2026-08-04',
      '2026-08-11',
      '2026-08-18',
      '2026-08-25',
      '2026-08-27',
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    );
    expect(currentStreak(monthly, entries, TODAY)).toBe(3);
  });
});

describe('rule 3: the period in progress cannot break a streak', () => {
  it('steps over a current period that has not been met yet', () => {
    // One of three so far this week, and three in each of the two before it:
    // Thursday is not a failed week.
    const entries = done(
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-14',
    );
    expect(currentStreak(weekly, entries, TODAY)).toBe(2);
  });

  it('adds the current period to the streak once it is met', () => {
    const entries = done('2026-09-07', '2026-09-08', '2026-09-09', '2026-09-14', '2026-09-15', '2026-09-16');
    expect(currentStreak(weekly, entries, TODAY)).toBe(2);
  });

  it('ends the streak at a finished period that fell short', () => {
    // Last week was missed and is over; this week's two days cannot bridge it.
    const entries = done('2026-08-31', '2026-09-01', '2026-09-02', '2026-09-07', '2026-09-14', '2026-09-15');
    expect(currentStreak(weekly, entries, TODAY)).toBe(0);
  });

  it('gives a habit with no history no streak', () => {
    expect(currentStreak(daily, [], TODAY)).toBe(0);
    expect(longestStreak(daily, [], TODAY)).toBe(0);
  });

  it('stops at the oldest entry rather than counting empty periods back to the epoch', () => {
    // Two days of history, both kept: the streak is 2, not "every day since
    // 1970 was missed".
    expect(currentStreak(daily, done('2026-09-16', '2026-09-17'), TODAY)).toBe(2);
  });
});

describe('longestStreak', () => {
  it('finds the best run rather than the current one', () => {
    const entries = done(
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    );
    expect(longestStreak(daily, entries, TODAY)).toBe(5);
    // Nothing since the 14th, so the run in progress is already over.
    expect(currentStreak(daily, entries, TODAY)).toBe(0);
  });

  it('counts a gap as the missed periods it is, not as nothing', () => {
    // Without the empty months in between, this would read as a streak of 4.
    const entries = done(
      '2026-01-02',
      '2026-01-09',
      '2026-01-16',
      '2026-01-23',
      '2026-01-30',
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    );
    expect(longestStreak(monthly, entries, TODAY)).toBe(1);
  });

  it('includes the current period when it is already met', () => {
    expect(longestStreak(daily, done('2026-09-16', '2026-09-17'), TODAY)).toBe(2);
  });

  it('does not count the current period against the run while it is in progress', () => {
    // Three weeks kept and this one still open: the best is 3, not reset to 0.
    const entries = done(
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    );
    expect(longestStreak(weekly, entries, TODAY)).toBe(3);
  });

  it('is never smaller than the current streak', () => {
    const entries = done('2026-09-15', '2026-09-16', '2026-09-17');
    expect(longestStreak(daily, entries, TODAY)).toBeGreaterThanOrEqual(currentStreak(daily, entries, TODAY));
  });
});

describe('tallyRecent', () => {
  it('returns the periods oldest first, ending with the one containing today', () => {
    const periods = tallyRecent(weekly, done('2026-09-14', '2026-09-15'), TODAY, 3);
    expect(periods.map((period) => period.start)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
    expect(periods.map((period) => period.done)).toEqual([0, 0, 2]);
  });
});
