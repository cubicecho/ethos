import { describe, expect, it } from 'vitest';
import { describeCadence, describeProgress, isPeriod, maxTargetFor } from '../cadence';
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
    expect(describeCadence('day', 1)).toBe('Every day');
  });

  it('drops the multiplier when there is only one', () => {
    expect(describeCadence('week', 1)).toBe('Once a week');
    expect(describeCadence('month', 1)).toBe('Once a month');
  });

  it('counts the rest', () => {
    expect(describeCadence('week', 3)).toBe('3× a week');
    expect(describeCadence('month', 20)).toBe('20× a month');
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
