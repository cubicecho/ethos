import { describe, expect, it } from 'vitest';
import { HABIT_DEFAULTS } from '../../core/defaults.ts';
import { periodOf } from '../../habits/periods.ts';
import { type EntryLike, type HabitLike, tallyPeriod, tallyRecent } from '../../habits/tallies.ts';

// What tallies.ts counts. Everything the app reports about a habit is a tally,
// so a change that quietly redefines "kept" fails here rather than in a
// screenshot six weeks later.

const daily: HabitLike = { period: 'day', targetCount: 1 };
const weekly: HabitLike = { period: 'week', targetCount: 3 };

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

  it('reads a period that met its target as kept', () => {
    const tally = tallyPeriod(weekly, done('2026-09-14', '2026-09-15', '2026-09-16'), periodOf('week', TODAY));
    expect(tally).toMatchObject({ done: 3, effectiveTarget: 3, met: true });
  });

  it('still reads a period as kept when more days were kept than asked for', () => {
    const tally = tallyPeriod(
      weekly,
      done('2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'),
      periodOf('week', TODAY),
    );
    expect(tally).toMatchObject({ done: 4, effectiveTarget: 3, met: true });
  });

  it('reads a period short of its target as missed', () => {
    const tally = tallyPeriod(weekly, done('2026-09-14'), periodOf('week', TODAY));
    expect(tally).toMatchObject({ done: 1, effectiveTarget: 3, met: false });
  });
});

describe('a skip is not a miss', () => {
  it('takes a skipped day off what the period asked for', () => {
    // "3× a week" with one day declined asks for two, and two days kept meet it.
    const entries = [...done('2026-09-14', '2026-09-15'), ...skipped('2026-09-16')];
    expect(tallyPeriod(weekly, entries, periodOf('week', TODAY))).toMatchObject({
      done: 2,
      skipped: 1,
      target: 3,
      effectiveTarget: 2,
      met: true,
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
    expect(tally).toMatchObject({ effectiveTarget: 0, met: true });
  });

  it('floors the effective target at zero rather than going negative', () => {
    // The cap is the resolver's. This module counts whatever rows it is handed,
    // and must not go negative if one gets past the cap.
    expect(HABIT_DEFAULTS.maxSkipsPerPeriod).toBe(2);
    const tally = tallyPeriod(daily, skipped('2026-09-14', '2026-09-15', '2026-09-16'), periodOf('week', TODAY));
    expect(tally.effectiveTarget).toBe(0);
    expect(tally.met).toBe(true);
  });

  it('treats an untouched day as the miss, not the skipped one', () => {
    // Two of three kept either way: declining the third meets the week, and
    // leaving it untouched does not.
    const kept = done('2026-09-14', '2026-09-15');
    const week = periodOf('week', TODAY);
    expect(tallyPeriod(weekly, [...kept, ...skipped('2026-09-16')], week).met).toBe(true);
    expect(tallyPeriod(weekly, kept, week).met).toBe(false);
  });
});

describe('tallyRecent', () => {
  it('returns the periods oldest first, ending with the one containing today', () => {
    const periods = tallyRecent(weekly, done('2026-09-14', '2026-09-15'), TODAY, 3);
    expect(periods.map((period) => period.start)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
    expect(periods.map((period) => period.done)).toEqual([0, 0, 2]);
  });
});
