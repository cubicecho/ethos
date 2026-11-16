import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatDayLong } from '@/lib/periods';
import { TODAY } from '../../__tests__/helpers';
import { DaySquare } from '../day-square';

// A square's fill is the habit's own colour, so what is asserted here is what
// is left for a reader who cannot see it: the label, the pressed state, and
// the cycle a press walks.

function renderSquare(props: Partial<Parameters<typeof DaySquare>[0]> = {}) {
  const onValueChange = vi.fn();
  // The grid and the overview each put one provider around all their squares.
  render(
    <TooltipProvider>
      <DaySquare
        day={TODAY}
        value={null}
        color="#7c3aed"
        isToday={false}
        isFuture={false}
        onValueChange={onValueChange}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onValueChange, square: screen.getByRole('button') };
}

describe('DaySquare', () => {
  it('carries its day in its label', () => {
    const { square } = renderSquare();
    expect(square).toHaveAccessibleName(new RegExp(`^${formatDayLong(TODAY)}`));
  });

  it.each([
    { value: 'done', state: /— kept$/, pressed: 'true' },
    { value: 'skipped', state: /— skipped$/, pressed: 'true' },
    { value: null, state: /— not kept$/, pressed: 'false' },
  ] as const)('says a $value day in words, apart from its colour', ({ value, state, pressed }) => {
    const { square } = renderSquare({ value });
    expect(square).toHaveAccessibleName(state);
    expect(square).toHaveAttribute('aria-pressed', pressed);
  });

  it.each([
    { from: null, to: 'done' },
    { from: 'done', to: 'skipped' },
    { from: 'skipped', to: null },
  ] as const)('turns a $from day into a $to one when pressed', async ({ from, to }) => {
    const { onValueChange, square } = renderSquare({ value: from });
    await userEvent.click(square);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(to);
  });

  it('draws a day to come, says so, and refuses the press', async () => {
    // A disabled Pressable is `pointer-events: none`, which user-event refuses
    // to click. Skip that check so the assertion is about the handler.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onValueChange, square } = renderSquare({ day: '2026-09-18', isFuture: true });
    expect(square).toBeDisabled();
    expect(square).toHaveAccessibleName(/— to come$/);
    await user.click(square);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('refuses the press while a mark is in flight', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onValueChange, square } = renderSquare({ disabled: true });
    expect(square).toBeDisabled();
    await user.click(square);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it.each([
    { measure: { partial: true, amount: 5, dailyAmount: 8 }, state: /— kept, 5 of 8, smaller version$/ },
    { measure: { partial: false, amount: 8, dailyAmount: 8 }, state: /— kept, 8 of 8$/ },
    // Past the goal is recorded as it was, and read as the goal met.
    { measure: { partial: false, amount: 10, dailyAmount: 8 }, state: /— kept, 8 of 8$/ },
    { measure: { partial: true, amount: 1, dailyAmount: 1 }, state: /— kept, smaller version$/ },
    { measure: { partial: false, amount: 1, dailyAmount: 1 }, state: /— kept$/ },
  ])('says how much a kept day held: $state', ({ measure, state }) => {
    const { square } = renderSquare({ value: 'done', measure });
    expect(square).toHaveAccessibleName(state);
  });

  it('says no amount on a skipped day', () => {
    const { square } = renderSquare({ value: 'skipped', measure: { partial: false, amount: 1, dailyAmount: 1 } });
    expect(square).toHaveAccessibleName(/— skipped$/);
  });

  it('keeps today pressable and saying its own state', () => {
    // Today is an outline, not a state: a kept today still reads as kept.
    const { square } = renderSquare({ isToday: true, value: 'done' });
    expect(square).toBeEnabled();
    expect(square).toHaveAccessibleName(/— kept$/);
  });
});
