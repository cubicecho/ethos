import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { daysOf, formatDayLong, periodOf, weekdayInitial } from '@/lib/periods';
import { HabitGrid } from '../habit-grid';
import type { HabitEntrySummary, HabitPeriodSummary, HabitSummary } from '../types';

// The grid is where the server's counting becomes something a person can read,
// so what is asserted here is mostly that it does not do any counting of its
// own — the tally beside a row is the server's, and the squares are laid out
// around it rather than adding up to it.

const TODAY = '2026-09-17';

const habit = (overrides: Partial<HabitSummary> = {}): HabitSummary => ({
  id: 'habit-1',
  name: 'Read',
  notes: null,
  color: '#7c3aed',
  period: 'day',
  targetCount: 1,
  position: 0,
  archivedAt: null,
  streak: 0,
  longestStreak: 0,
  current: period(TODAY, '2026-09-18'),
  todayEntry: [],
  ...overrides,
});

const period = (start: string, end: string, overrides: Partial<HabitPeriodSummary> = {}): HabitPeriodSummary => ({
  start,
  end,
  done: 0,
  skipped: 0,
  target: 3,
  effectiveTarget: 3,
  met: false,
  rate: 0,
  ...overrides,
});

const entry = (day: string, status: string): HabitEntrySummary => ({
  id: `entry-${day}`,
  day,
  status,
  note: null,
});

/**
 * The header's initials, Monday first. The header is `aria-hidden` — each square already says its
 * day — so it has no role to find it by, and its text is the only handle.
 */
const INITIALS = daysOf(periodOf('week', TODAY)).map(weekdayInitial);
const weekdayHeader = () => screen.queryAllByText((text) => INITIALS.includes(text));

const square = (day: string) => screen.getByRole('button', { name: new RegExp(formatDayLong(day)) });

function renderGrid(props: Partial<Parameters<typeof HabitGrid>[0]> = {}) {
  const onSet = vi.fn();
  render(
    <HabitGrid habit={habit()} history={[]} entries={[]} today={TODAY} isPending={false} onSet={onSet} {...props} />,
  );
  return { onSet };
}

describe('HabitGrid for a daily habit', () => {
  it('lays its days out in weeks rather than one row per day', () => {
    // A row per period would be a column of single squares. Four weeks of seven
    // reads as a month, and the squares still mean one day each.
    renderGrid();
    expect(screen.getAllByRole('button')).toHaveLength(28);
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Last week')).toBeInTheDocument();
  });

  it('shows no tally beside a week, because the week is not its period', () => {
    renderGrid({ history: [period('2026-09-17', '2026-09-18', { done: 1, met: true })] });
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
  });

  it('names the columns once, at the top', () => {
    renderGrid();
    // Seven initials over seven aligned columns — Monday-first, like the weeks
    // the server counts.
    expect(weekdayHeader().map((initial) => initial.textContent)).toEqual(INITIALS);
  });
});

describe('HabitGrid for a weekly habit', () => {
  const weekly = habit({ period: 'week', targetCount: 3 });
  const history = [
    period('2026-09-07', '2026-09-14', { done: 3, met: true }),
    period('2026-09-14', '2026-09-21', { done: 2, effectiveTarget: 3 }),
  ];

  it('draws one row per period, with the period as the row', () => {
    renderGrid({ habit: weekly, history });
    expect(screen.getByText('Last week')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(14);
  });

  it('prints the server’s tally rather than counting the squares', () => {
    // The history says three days were kept; not one entry is passed in. The
    // grid must still say 3/3 — the counting is streaks.ts's, not the grid's.
    renderGrid({ habit: weekly, history, entries: [] });
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('shows a period skipped down to nothing owed as kept', () => {
    renderGrid({
      habit: weekly,
      history: [period('2026-09-14', '2026-09-21', { done: 0, skipped: 3, effectiveTarget: 0, met: true })],
    });
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });
});

describe('HabitGrid for a monthly habit', () => {
  it('has no weekday header, because its rows start on whatever day the first is', () => {
    renderGrid({
      habit: habit({ period: 'month', targetCount: 10 }),
      history: [period('2026-09-01', '2026-10-01', { done: 4, target: 10, effectiveTarget: 10 })],
    });
    expect(weekdayHeader()).toHaveLength(0);
    // September has thirty days, and the row draws all of them.
    expect(screen.getAllByRole('button')).toHaveLength(30);
  });
});

describe('HabitGrid squares', () => {
  it('says what each day is, so the state is readable without the colour', () => {
    renderGrid({ entries: [entry('2026-09-16', 'done'), entry('2026-09-15', 'skipped')] });
    expect(square('2026-09-16')).toHaveAccessibleName(/kept$/);
    expect(square('2026-09-15')).toHaveAccessibleName(/skipped$/);
    expect(square('2026-09-14')).toHaveAccessibleName(/not kept$/);
  });

  it('draws the rest of the period but does not let a future day be marked', () => {
    // The week holds today, so the 18th through the 20th are drawn and dead.
    const { start, end } = periodOf('week', TODAY);
    expect(start).toBe('2026-09-14');
    expect(end).toBe('2026-09-21');
    renderGrid();
    expect(square('2026-09-18')).toBeDisabled();
    expect(square('2026-09-18')).toHaveAccessibleName(/to come$/);
    expect(square(TODAY)).toBeEnabled();
  });

  it('cycles a day through kept, skipped and back to nothing', async () => {
    const user = userEvent.setup();
    const { onSet } = renderGrid({ entries: [entry('2026-09-16', 'done'), entry('2026-09-15', 'skipped')] });

    // Undo is the third click, which is why "nothing" is in the cycle.
    await user.click(square('2026-09-14'));
    await user.click(square('2026-09-16'));
    await user.click(square('2026-09-15'));

    expect(onSet.mock.calls).toEqual([
      ['2026-09-14', 'done'],
      ['2026-09-16', 'skipped'],
      ['2026-09-15', null],
    ]);
  });

  it('stops taking clicks while a mark is in flight', async () => {
    // A disabled Pressable is `pointer-events: none`, which user-event refuses
    // to click. Skip that check so the assertion is about the handler.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onSet } = renderGrid({ isPending: true });
    await user.click(square(TODAY));
    expect(onSet).not.toHaveBeenCalled();
  });
});
