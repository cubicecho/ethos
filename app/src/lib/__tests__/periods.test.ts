import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  daysBetween,
  daysOf,
  formatDay,
  formatDayLong,
  isDay,
  periodBefore,
  periodEnd,
  periodLabel,
  periodOf,
  periodStart,
  recentPeriods,
  today,
  weekdayInitial,
} from '../periods';

// The other half of `server/src/__tests__/habits/periods.test.ts`. The two modules are
// deliberate copies of each other — the grid draws the periods the streak is
// counted over — so the boundary cases are asserted on both sides, and a change
// made to one file and not the other fails here.

describe('today', () => {
  afterEach(() => vi.useRealTimers());

  it('reads the device’s own day, not UTC', () => {
    // The only local-clock read in the app. At 23:00 on the 17th UTC it is
    // already the 18th in Auckland, and what matters is the holder's day.
    const local = new Date(2026, 8, 18, 23, 0, 0);
    expect(today(local)).toBe('2026-09-18');
  });

  it('pads a single-digit month and day', () => {
    expect(today(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('defaults to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 9, 30));
    expect(today()).toBe('2026-09-17');
  });
});

describe('isDay', () => {
  it('accepts a calendar day', () => {
    expect(isDay('2026-09-17')).toBe(true);
    expect(isDay('2024-02-29')).toBe(true);
  });

  it.each(['2026-9-17', '2026-09-17T00:00:00Z', 'not-a-day', '', '2026-02-31', '2025-02-29', '2026-13-01'])(
    'rejects %s',
    (value) => {
      expect(isDay(value)).toBe(false);
    },
  );

  it('answers rather than throwing, unlike the server’s assertDay', () => {
    // The client asks whether a string is a day; the server is told one and has
    // to refuse. Same predicate, two shapes.
    expect(() => isDay('nonsense')).not.toThrow();
  });
});

describe('day arithmetic', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('does not lose a day across a DST transition', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(daysBetween('2026-03-05', '2026-03-12')).toBe(7);
  });

  it('counts whole days, signed', () => {
    expect(daysBetween('2026-09-17', '2026-09-20')).toBe(3);
    expect(daysBetween('2026-09-20', '2026-09-17')).toBe(-3);
    expect(daysBetween('2026-09-17', '2026-09-17')).toBe(0);
  });
});

describe('period boundaries', () => {
  it('starts a week on Monday, the way the server does', () => {
    expect(periodStart('week', '2026-09-17')).toBe('2026-09-14');
    expect(periodStart('week', '2026-09-14')).toBe('2026-09-14');
    // Sunday belongs to the week behind it, not the one ahead.
    expect(periodStart('week', '2026-09-20')).toBe('2026-09-14');
    expect(periodStart('week', '2026-09-21')).toBe('2026-09-21');
  });

  it('bounds a day, a week and a month exclusively', () => {
    expect(periodOf('day', '2026-09-17')).toEqual({ start: '2026-09-17', end: '2026-09-18' });
    expect(periodOf('week', '2026-09-17')).toEqual({ start: '2026-09-14', end: '2026-09-21' });
    expect(periodOf('month', '2026-09-17')).toEqual({ start: '2026-09-01', end: '2026-10-01' });
    expect(periodEnd('month', '2026-12-25')).toBe('2027-01-01');
  });

  it('steps back by whole periods, not fixed spans', () => {
    expect(periodBefore('month', '2026-03-15')).toEqual({ start: '2026-02-01', end: '2026-03-01' });
    expect(periodBefore('week', '2026-09-17', 2)).toEqual({ start: '2026-08-31', end: '2026-09-07' });
  });

  it('tiles the recent periods, oldest first', () => {
    const periods = recentPeriods('week', '2026-09-17', 4);
    expect(periods.map((period) => period.start)).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    for (let index = 1; index < periods.length; index += 1) {
      expect(periods[index - 1].end).toBe(periods[index].start);
    }
  });
});

describe('daysOf', () => {
  it('gives a week its seven squares', () => {
    expect(daysOf(periodOf('week', '2026-09-17'))).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('gives each month the days it actually has', () => {
    expect(daysOf(periodOf('month', '2026-02-10'))).toHaveLength(28);
    expect(daysOf(periodOf('month', '2024-02-10'))).toHaveLength(29);
    expect(daysOf(periodOf('month', '2026-08-10'))).toHaveLength(31);
  });

  it('gives a day itself', () => {
    expect(daysOf(periodOf('day', '2026-09-17'))).toEqual(['2026-09-17']);
  });
});

describe('formatting', () => {
  // Pinned to UTC in the module, so a label cannot name the day before the one
  // it was given. The assertions avoid locale-specific wording.
  it('renders the day it was given, not the one its midnight lands on', () => {
    expect(formatDay('2026-09-17')).toContain('17');
    expect(formatDayLong('2026-09-17')).toContain('17');
    expect(formatDayLong('2026-01-01')).toContain('2026');
  });

  it('names the weekday of the day, not of its local midnight', () => {
    // 2026-09-14 is a Monday and 2026-09-20 the Sunday that ends its week.
    expect(weekdayInitial('2026-09-14')).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' }).format(Date.UTC(2026, 8, 14)),
    );
  });
});

describe('periodLabel', () => {
  const from = '2026-09-17';

  it('names the near periods by relation', () => {
    expect(periodLabel('day', '2026-09-17', from)).toBe('Today');
    expect(periodLabel('day', '2026-09-16', from)).toBe('Yesterday');
    expect(periodLabel('week', '2026-09-14', from)).toBe('This week');
    expect(periodLabel('week', '2026-09-07', from)).toBe('Last week');
    expect(periodLabel('month', '2026-09-01', from)).toBe('This month');
    expect(periodLabel('month', '2026-08-01', from)).toBe('Last month');
  });

  it('names the far ones by date, because at that distance the reader wants when', () => {
    expect(periodLabel('day', '2026-09-01', from)).toContain('1');
    expect(periodLabel('week', '2026-08-31', from)).toContain('31');
    expect(periodLabel('month', '2026-06-01', from)).toContain('2026');
  });
});
