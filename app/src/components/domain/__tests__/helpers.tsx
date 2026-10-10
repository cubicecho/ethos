import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { HabitEntrySummary, HabitPeriodSummary, HabitSummary } from '../habit/types';

// What the component tests share: a day, a habit as the server serves it, and
// a render under Apollo. Everything carries its `__typename`, because a
// mutation's result is normalized into the cache by it.

/** A Thursday, mid-week and mid-month, so no test is accidentally on a boundary. */
export const TODAY = '2026-09-17';

/**
 * One period's tally, as `HabitPeriodFields` serves it.
 *
 * @param [overrides] - The fields a test is about.
 * @returns The tally: today's, with nothing kept.
 */
export const tally = (overrides: Partial<HabitPeriodSummary> = {}): HabitPeriodSummary => ({
  __typename: 'HabitPeriod',
  start: TODAY,
  end: '2026-09-18',
  done: 0,
  skipped: 0,
  target: 1,
  effectiveTarget: 1,
  met: false,
  ...overrides,
});

/**
 * One day's entry, as `HabitEntryFields` serves it.
 *
 * @param day - The day.
 * @param status - What the day says.
 * @returns The entry.
 */
export const entry = (day: string, status: string): HabitEntrySummary => ({
  __typename: 'HabitEntry',
  id: `entry-${day}`,
  day,
  status,
  note: null,
  partial: false,
});

/**
 * A habit, as `HabitFields` serves it.
 *
 * @param [overrides] - The fields a test is about.
 * @returns The habit: daily, active, and untouched today.
 */
export const habit = (overrides: Partial<HabitSummary> = {}): HabitSummary => ({
  __typename: 'Habit',
  id: 'habit-1',
  name: 'Read',
  notes: null,
  cue: null,
  color: '#7c3aed',
  period: 'day',
  targetCount: 1,
  position: 0,
  archivedAt: null,
  current: tally(),
  todayEntry: [],
  ...overrides,
});

/**
 * Renders under Apollo's `MockedProvider`, which fails a request it was not told about.
 *
 * @param ui - What to render.
 * @param [mocks] - The requests the test expects, each with its answer.
 * @returns What `render` returns.
 */
export function renderWithApollo(ui: ReactElement, mocks: readonly MockedResponse[] = []) {
  return render(<MockedProvider mocks={mocks}>{ui}</MockedProvider>);
}
