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

  it('keeps today pressable and saying its own state', () => {
    // Today is an outline, not a state: a kept today still reads as kept.
    const { square } = renderSquare({ isToday: true, value: 'done' });
    expect(square).toBeEnabled();
    expect(square).toHaveAccessibleName(/— kept$/);
  });
});
