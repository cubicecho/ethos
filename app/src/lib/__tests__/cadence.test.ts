import { describe, expect, it } from 'vitest';
import {
  describeAmount,
  describeAmountLimit,
  describeCadence,
  describeProgress,
  isPeriod,
  maxAmount,
  maxTargetFor,
} from '../cadence';
import { Period } from '../periods';

// The ceiling here is a copy of `server/src/habits/cadence.ts`, and the server's is the
// one that decides. This one exists so the form refuses an impossible target
// while it is still being typed — so the numbers have to agree.

describe('Period', () => {
  it('is the three the database allows, in the order the form shows them', () => {
    expect(Object.values(Period)).toEqual(['day', 'week', 'month']);
  });

  it('recognises a period and nothing else', () => {
    expect(isPeriod('week')).toBe(true);
    expect(isPeriod('year')).toBe(false);
    expect(isPeriod('')).toBe(false);
    // A stored value arrives as a plain string; this is what narrows it.
    expect(isPeriod('Week')).toBe(false);
  });
});

describe('maxTargetFor', () => {
  it('agrees with the server: 1, 7 and 28', () => {
    expect(maxTargetFor('day')).toBe(1);
    expect(maxTargetFor('week')).toBe(7);
    // February, not whichever month it happens to be — a cadence that works in
    // August and fails in February is a habit that breaks once a year.
    expect(maxTargetFor('month')).toBe(28);
  });
});

describe('describeCadence', () => {
  it('says what a daily habit is without counting it', () => {
    expect(describeCadence('day', 1, 1)).toBe('Every day');
  });

  it('drops the multiplier when there is only one', () => {
    expect(describeCadence('week', 1, 1)).toBe('Once a week');
    expect(describeCadence('month', 1, 1)).toBe('Once a month');
  });

  it('counts the rest', () => {
    expect(describeCadence('week', 3, 1)).toBe('3× a week');
    expect(describeCadence('month', 20, 1)).toBe('20× a month');
  });
});

describe('describeCadence, with a daily amount', () => {
  it('says how much of a daily habit each day asks for', () => {
    expect(describeCadence('day', 1, 8)).toBe('8× every day');
  });

  it('puts the amount a day before the days a period', () => {
    expect(describeCadence('week', 5, 8)).toBe('8× a day, 5 days a week');
    expect(describeCadence('month', 1, 3)).toBe('3× a day, once a month');
  });

  it('groups the thousands of a large amount', () => {
    expect(describeCadence('day', 1, 10_000)).toBe('10,000× every day');
  });
});

describe('describeAmount', () => {
  it('says how much of the day was done', () => {
    expect(describeAmount(5, 8)).toBe('5 of 8');
    expect(describeAmount(0, 8)).toBe('0 of 8');
  });

  it('stops at the goal: a day past it reads as the goal met', () => {
    expect(describeAmount(8, 8)).toBe('8 of 8');
    expect(describeAmount(10, 8)).toBe('8 of 8');
  });
});

describe('maxAmount', () => {
  // The server test for the cap asserts this number is the server's own.
  it('is high enough for a step count', () => {
    expect(maxAmount()).toBeGreaterThanOrEqual(10_000);
    expect(describeAmountLimit()).toContain('1 to ');
  });
});

describe('describeProgress', () => {
  it('names the period the reader is in', () => {
    expect(describeProgress(1, 1, 'day')).toBe('1 of 1 today');
    expect(describeProgress(2, 3, 'week')).toBe('2 of 3 this week');
    expect(describeProgress(5, 10, 'month')).toBe('5 of 10 this month');
  });

  it('counts against what the period actually asked for, after its skips', () => {
    // A week of 3× with one day skipped asks for two, and the line says so —
    // otherwise the screen reports a shortfall the habit does not have.
    expect(describeProgress(2, 2, 'week')).toBe('2 of 2 this week');
  });
});
