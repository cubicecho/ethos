import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../../core/errors.ts';
import {
  addDays,
  assertDay,
  daysBetween,
  periodBefore,
  periodEnd,
  periodLength,
  periodOf,
  periodStart,
  recentPeriods,
} from '../../habits/periods.ts';

// The bug this file exists to catch is the quiet one: a day that shifts by one
// because something parsed it as an instant. Every case below is a day that a
// local-time implementation gets wrong somewhere on earth, so a regression
// shows up as a date, not as a timezone-dependent flake.

describe('assertDay', () => {
  it('accepts a calendar day and returns it unchanged', () => {
    expect(assertDay('2026-09-17')).toBe('2026-09-17');
    expect(assertDay('2024-02-29')).toBe('2024-02-29');
  });

  it.each([
    ['2026-9-17', 'unpadded'],
    ['2026-09-17T00:00:00Z', 'an instant'],
    ['not-a-day', 'nonsense'],
    ['', 'empty'],
    // Parses happily as the third of March, which is a different day than the
    // one the caller named — the round-trip is what catches it.
    ['2026-02-31', 'a day February does not have'],
    ['2025-02-29', 'a leap day in a common year'],
    ['2026-13-01', 'a thirteenth month'],
  ])('refuses %s (%s)', (day) => {
    expect(() => assertDay(day)).toThrow(/is not a date/);
  });

  it('refuses with BAD_USER_INPUT rather than a 500', () => {
    expect(() => assertDay('nope')).toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: ErrorCode.BadUserInput }) }),
    );
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary in both directions', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('knows which Februaries have a 29th', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('does not lose a day across a DST transition', () => {
    // The US springs forward on 2026-03-08 and falls back on 2026-11-01. A
    // local-time implementation returns the same day twice on one of them.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween('2026-09-17', '2026-09-20')).toBe(3);
    expect(daysBetween('2026-09-20', '2026-09-17')).toBe(-3);
    expect(daysBetween('2026-09-17', '2026-09-17')).toBe(0);
  });

  it('counts a DST week as seven days', () => {
    expect(daysBetween('2026-03-05', '2026-03-12')).toBe(7);
    expect(daysBetween('2026-10-29', '2026-11-05')).toBe(7);
  });
});

describe('periodStart', () => {
  it('leaves a daily period where it is', () => {
    expect(periodStart('day', '2026-09-17')).toBe('2026-09-17');
  });

  it('starts a week on Monday', () => {
    // 2026-09-17 is a Thursday; the week it belongs to began on the 14th.
    expect(periodStart('week', '2026-09-17')).toBe('2026-09-14');
    // Monday is its own start, and Sunday belongs to the week behind it rather
    // than the one ahead — the whole point of ISO weeks over Sunday-first ones.
    expect(periodStart('week', '2026-09-14')).toBe('2026-09-14');
    expect(periodStart('week', '2026-09-20')).toBe('2026-09-14');
    expect(periodStart('week', '2026-09-21')).toBe('2026-09-21');
  });

  it('starts a month on the first', () => {
    expect(periodStart('month', '2026-09-17')).toBe('2026-09-01');
    expect(periodStart('month', '2026-09-01')).toBe('2026-09-01');
  });
});

describe('periodEnd', () => {
  it('is exclusive, so periods tile without overlapping', () => {
    expect(periodEnd('day', '2026-09-17')).toBe('2026-09-18');
    expect(periodEnd('week', '2026-09-17')).toBe('2026-09-21');
    expect(periodEnd('month', '2026-09-17')).toBe('2026-10-01');
  });

  it('rolls a December into the next January', () => {
    expect(periodEnd('month', '2026-12-25')).toBe('2027-01-01');
  });

  it('gives each month the days it actually has', () => {
    expect(periodLength('month', '2026-02-10')).toBe(28);
    expect(periodLength('month', '2024-02-10')).toBe(29);
    expect(periodLength('month', '2026-08-10')).toBe(31);
    expect(periodLength('week', '2026-09-17')).toBe(7);
    expect(periodLength('day', '2026-09-17')).toBe(1);
  });
});

describe('periodOf and periodBefore', () => {
  it('bounds the period a day falls in', () => {
    expect(periodOf('week', '2026-09-17')).toEqual({ start: '2026-09-14', end: '2026-09-21' });
  });

  it('steps back by whole periods, not by fixed spans', () => {
    expect(periodBefore('week', '2026-09-17')).toEqual({ start: '2026-09-07', end: '2026-09-14' });
    expect(periodBefore('week', '2026-09-17', 2)).toEqual({ start: '2026-08-31', end: '2026-09-07' });
    // A month step is 31 days here and 28 there; counting days would drift.
    expect(periodBefore('month', '2026-03-15')).toEqual({ start: '2026-02-01', end: '2026-03-01' });
    expect(periodBefore('month', '2026-03-15', 3)).toEqual({ start: '2025-12-01', end: '2026-01-01' });
  });

  it('steps nowhere when asked for zero', () => {
    expect(periodBefore('week', '2026-09-17', 0)).toEqual(periodOf('week', '2026-09-17'));
  });
});

describe('recentPeriods', () => {
  it('ends with the period containing the day, oldest first', () => {
    const periods = recentPeriods('week', '2026-09-17', 3);
    expect(periods.map((period) => period.start)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
  });

  it('tiles: each period ends exactly where the next begins', () => {
    const periods = recentPeriods('month', '2026-01-15', 14);
    expect(periods).toHaveLength(14);
    for (let index = 1; index < periods.length; index += 1) {
      expect(periods[index - 1].end).toBe(periods[index].start);
    }
    expect(periods.at(-1)?.start).toBe('2026-01-01');
  });
});
