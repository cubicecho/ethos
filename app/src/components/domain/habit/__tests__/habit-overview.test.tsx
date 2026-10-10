import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatDayLong, periodOf } from '@/lib/periods';
import { HabitOverview } from '../habit-overview';
import type { HabitOverviewSummary, HabitPeriodSummary } from '../types';

// The overview puts habits of different cadences on one span of days, so what
// is asserted here is which rows may carry the server's tally and that a press
// names the habit whose row it was in.

vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const TODAY = '2026-09-17';
const THIS_WEEK = periodOf('week', TODAY);

const tally = (start: string, end: string, overrides: Partial<HabitPeriodSummary> = {}): HabitPeriodSummary => ({
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

const habit = (overrides: Partial<HabitOverviewSummary> = {}): HabitOverviewSummary => ({
  id: 'habit-1',
  name: 'Read',
  notes: null,
  cue: null,
  color: '#7c3aed',
  period: 'day',
  targetCount: 1,
  position: 0,
  archivedAt: null,
  streak: 0,
  longestStreak: 0,
  current: tally(TODAY, '2026-09-18'),
  todayEntry: [],
  rangeEntries: [],
  ...overrides,
});

const entry = (day: string, status: string) => ({ id: `entry-${day}`, day, status, note: null, partial: false });

const row = (name: string) => screen.getByRole('listitem', { name });
const square = (name: string, day: string) =>
  within(row(name)).getByRole('button', { name: new RegExp(formatDayLong(day)) });

function renderOverview(habits: HabitOverviewSummary[], range = THIS_WEEK) {
  const onValueChange = vi.fn();
  render(<HabitOverview habits={habits} range={range} today={TODAY} disabled={false} onValueChange={onValueChange} />);
  return { onValueChange };
}

describe('HabitOverview', () => {
  it('draws a row a habit and a square a day', () => {
    renderOverview([habit(), habit({ id: 'habit-2', name: 'Run' })]);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(within(row('Run')).getAllByRole('button')).toHaveLength(7);
  });

  it('draws every day of a month', () => {
    renderOverview([habit()], periodOf('month', TODAY));
    expect(within(row('Read')).getAllByRole('button')).toHaveLength(30);
  });

  it("prints the server's tally when the span is the habit's own current period", () => {
    // Two squares are filled and the tally says one: the number is the
    // server's, not a count of what is drawn.
    const weekly = habit({
      period: 'week',
      targetCount: 3,
      current: tally(THIS_WEEK.start, THIS_WEEK.end, { done: 1 }),
      rangeEntries: [entry('2026-09-14', 'done'), entry('2026-09-15', 'done')],
    });
    renderOverview([weekly]);
    expect(within(row('Read')).getByText('1/3')).toBeTruthy();
  });

  it('counts kept days, and offers no rate, for a span the habit is not counted over', () => {
    const daily = habit({
      rangeEntries: [entry('2026-09-14', 'done'), entry('2026-09-15', 'done'), entry('2026-09-16', 'skipped')],
    });
    renderOverview([daily]);
    expect(within(row('Read')).getByLabelText('2 days kept')).toBeTruthy();
    expect(within(row('Read')).queryByText(/\//)).toBeNull();
  });

  it('names the habit whose square was pressed', async () => {
    const { onValueChange } = renderOverview([
      habit(),
      habit({ id: 'habit-2', name: 'Run', rangeEntries: [entry('2026-09-15', 'done')] }),
    ]);
    await userEvent.click(square('Run', '2026-09-15'));
    expect(onValueChange).toHaveBeenCalledWith('habit-2', '2026-09-15', 'skipped');
  });

  it('says which square is today, and says it of no other', () => {
    renderOverview([habit()]);
    expect(within(row('Read')).getAllByRole('button', { name: /, today — / })).toHaveLength(1);
    expect(square('Read', TODAY).getAttribute('aria-label')).toBe(`${formatDayLong(TODAY)}, today — not kept`);
  });

  it('says a smaller version in the label, and draws it as kept', () => {
    const smaller = { ...entry('2026-09-15', 'done'), partial: true, note: 'One page' };
    renderOverview([habit({ rangeEntries: [smaller, entry('2026-09-16', 'done')] })]);
    expect(square('Read', '2026-09-15').getAttribute('aria-label')).toMatch(/— kept, smaller version$/);
    expect(square('Read', '2026-09-16').getAttribute('aria-label')).toMatch(/— kept$/);
    // Counted whole: two kept days, not one and a half.
    expect(within(row('Read')).getByLabelText('2 days kept')).toBeTruthy();
  });

  it('refuses a day that has not happened', () => {
    renderOverview([habit()]);
    expect(square('Read', '2026-09-18')).toHaveProperty('disabled', true);
  });
});
