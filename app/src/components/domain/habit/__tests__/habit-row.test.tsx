import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeAmountLimit } from '@/lib/cadence';
import { ClearHabitDocument, MarkHabitDocument } from '@/lib/graphql';
import { entry, habit, renderWithApollo, TODAY, tally } from '../../__tests__/helpers';
import { HabitRow } from '../habit-row';
import type { HabitSummary } from '../types';

// The row is where a day is most often recorded, so what is asserted is what it
// sends, that it waits for the answer rather than guessing it, and that a
// refusal is read out beside the control that caused it.

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => router }));

/** Longer than three presses take: a press through react-native-web is not instant. */
const IN_FLIGHT_MS = 600;

const kept = habit({ todayEntry: [entry(TODAY, 'done')], current: tally({ done: 1, met: true }) });
const skipped = habit({ todayEntry: [entry(TODAY, 'skipped')], current: tally({ skipped: 1, effectiveTarget: 0 }) });

/**
 * A `markHabit` the test expects, answering with the habit as the server would return it.
 *
 * @param status - The status the row must send.
 * @param [delay] - How long the answer takes.
 * @returns The mock, and the spy that says it was asked.
 */
function markMock(status: string, delay = 0) {
  const result = vi.fn(() => ({ data: { markHabit: status === 'done' ? kept : skipped } }));
  const mock: MockedResponse = {
    request: { query: MarkHabitDocument, variables: { habitId: 'habit-1', day: TODAY, status, today: TODAY } },
    result,
    delay,
  };
  return { mock, result };
}

/**
 * A `clearHabit` the test expects.
 *
 * @returns The mock, and the spy that says it was asked.
 */
function clearMock() {
  const result = vi.fn(() => ({ data: { clearHabit: habit() } }));
  const mock: MockedResponse = {
    request: { query: ClearHabitDocument, variables: { habitId: 'habit-1', day: TODAY, today: TODAY } },
    result,
  };
  return { mock, result };
}

const done = (name: RegExp) => screen.getByRole('button', { name });

describe('HabitRow', () => {
  beforeEach(() => {
    router.push.mockClear();
  });

  it('names the habit, its cadence and where the period stands', () => {
    renderWithApollo(
      <HabitRow
        habit={habit({ period: 'week', targetCount: 3, current: tally({ done: 1, target: 3, effectiveTarget: 3 }) })}
        today={TODAY}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Read');
    expect(row).toHaveTextContent(/3.*week/i);
    expect(row).toHaveTextContent(/1.*3/);
  });

  it('shows no streak', () => {
    renderWithApollo(<HabitRow habit={kept} today={TODAY} />);
    expect(screen.getByRole('listitem')).not.toHaveTextContent(/streak/i);
  });

  it('says a skipped day is skipped rather than how far along the period is', () => {
    renderWithApollo(<HabitRow habit={skipped} today={TODAY} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('Skipped today');
  });

  it('marks today kept, for the caller’s own day', async () => {
    const { mock, result } = markMock('done');
    renderWithApollo(<HabitRow habit={habit()} today={TODAY} />, [mock]);

    const control = done(/^Mark Read kept today$/);
    expect(control).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(control);

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('skips today from its own control', async () => {
    const { mock, result } = markMock('skipped');
    renderWithApollo(<HabitRow habit={habit()} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Skip Read today$/));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears a kept day when its tick is pressed again', async () => {
    const { mock, result } = clearMock();
    renderWithApollo(<HabitRow habit={kept} today={TODAY} />, [mock]);

    const control = done(/^Undo Read for today$/);
    expect(control).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(control);

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('clears a skipped day when its skip is pressed again', async () => {
    const { mock, result } = clearMock();
    renderWithApollo(<HabitRow habit={skipped} today={TODAY} />, [mock]);

    const control = done(/^Un-skip Read today$/);
    expect(control).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(control);

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('turns a skipped day into a kept one without clearing it first', async () => {
    const { mock, result } = markMock('done');
    renderWithApollo(<HabitRow habit={skipped} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Mark Read kept today$/));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('takes no second press on either control while the mark is in flight', async () => {
    // Nothing is answered optimistically, so the controls waiting is all the reader sees.
    const { mock, result } = markMock('done', IN_FLIGHT_MS);
    renderWithApollo(<HabitRow habit={habit()} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Mark Read kept today$/));

    // Asserted by what the presses do: a second request would find no mock
    // left, and the row would read that failure out. A disabled button takes no
    // pointer events, so the presses go through without user-event's check.
    expect(done(/^Skip Read today$/)).toBeDisabled();
    const presser = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    await presser.click(done(/^Skip Read today$/));
    await presser.click(done(/^Mark Read kept today$/));
    expect(result).not.toHaveBeenCalled();

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1), { timeout: IN_FLIGHT_MS * 3 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(done(/^Mark Read kept today$/)).toBeEnabled();
  });

  it('reads out the server’s refusal beside the row and lets the reader try again', async () => {
    const refusal: MockedResponse = {
      request: {
        query: MarkHabitDocument,
        variables: { habitId: 'habit-1', day: TODAY, status: 'skipped', today: TODAY },
      },
      result: { errors: [{ message: 'Skip limit reached for this period.' }] },
    };
    renderWithApollo(<HabitRow habit={habit()} today={TODAY} />, [refusal]);

    await userEvent.click(done(/^Skip Read today$/));

    expect(await screen.findByRole('alert')).toHaveTextContent(/skip limit/i);
  });

  it('opens the habit when the row itself is pressed, and marks nothing', async () => {
    renderWithApollo(<HabitRow habit={habit()} today={TODAY} />);

    await userEvent.click(screen.getByRole('button', { name: /^Read/ }));

    expect(router.push).toHaveBeenCalledExactlyOnceWith('/habits/habit-1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('draws no stepper for a habit that asks for one a day', () => {
    renderWithApollo(<HabitRow habit={kept} today={TODAY} />);
    expect(screen.queryByRole('textbox', { name: /^Amount of/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^One more of/ })).not.toBeInTheDocument();
  });
});

describe('HabitRow with a daily amount', () => {
  /**
   * The water habit, asking for eight a day, with `amount` recorded today.
   *
   * @param [amount] - What today holds. Left out, today is untouched.
   * @param [note] - The day's note.
   * @returns The habit.
   */
  const water = (amount?: number, note: string | null = null): HabitSummary =>
    habit({
      name: 'Water',
      dailyAmount: 8,
      todayEntry:
        amount === undefined ? [] : [entry(TODAY, 'done', { amount, dailyAmount: 8, partial: amount < 8, note })],
      current: tally(amount === undefined ? {} : { done: 1, met: true }),
    });

  /**
   * A `markHabit` with exactly these variables, answering with `answer`.
   *
   * @param variables - What the row must send beside the habit, the day and today.
   * @param answer - The habit the server hands back.
   * @param [delay] - How long the answer takes.
   * @returns The mock, and the spy that says it was asked.
   */
  function amountMock(variables: Record<string, unknown>, answer: HabitSummary, delay = 0) {
    const result = vi.fn(() => ({ data: { markHabit: answer } }));
    const mock: MockedResponse = {
      request: { query: MarkHabitDocument, variables: { habitId: 'habit-1', day: TODAY, today: TODAY, ...variables } },
      result,
      delay,
    };
    return { mock, result };
  }

  const amountBox = () => screen.getByRole('textbox', { name: 'Amount of Water today' });

  it('shows the stepper with the day’s amount, and how far along it is', () => {
    renderWithApollo(<HabitRow habit={water(5)} today={TODAY} />);
    expect(amountBox()).toHaveValue('5');
    expect(screen.getByRole('listitem')).toHaveTextContent('5 of 8 today');
    expect(screen.getByRole('listitem')).toHaveTextContent('8× every day');
  });

  it('adds one, sending the total and the day’s note again', async () => {
    const { mock, result } = amountMock(
      { status: 'done', amount: 6, note: 'Tap water', partial: false },
      water(6, 'Tap water'),
    );
    renderWithApollo(<HabitRow habit={water(5, 'Tap water')} today={TODAY} />, [mock]);

    await userEvent.click(done(/^One more of Water today$/));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps counting past the goal, and still says the goal is met', async () => {
    const { mock, result } = amountMock({ status: 'done', amount: 9, note: null, partial: false }, water(9));
    renderWithApollo(<HabitRow habit={water(8)} today={TODAY} />, [mock]);

    const more = done(/^One more of Water today$/);
    expect(more).toBeEnabled();
    await userEvent.click(more);

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('says a day past the goal is the goal met, and shows the number that was recorded', () => {
    renderWithApollo(<HabitRow habit={water(10)} today={TODAY} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('8 of 8 today');
    expect(amountBox()).toHaveValue('10');
    expect(done(/^Undo Water for today$/)).toBeInTheDocument();
  });

  it('sends a typed number as one write', async () => {
    const { mock, result } = amountMock({ status: 'done', amount: 7, note: null, partial: false }, water(7));
    renderWithApollo(<HabitRow habit={water(2)} today={TODAY} />, [mock]);

    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), '7{Enter}');
    await userEvent.tab();

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a typed number that is not a whole one, and sends nothing', async () => {
    renderWithApollo(<HabitRow habit={water(2)} today={TODAY} />);

    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), '2.5{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(describeAmountLimit());
    expect(amountBox()).toHaveValue('2');
  });

  it('clears the day when one less would leave nothing', async () => {
    const result = vi.fn(() => ({ data: { clearHabit: water() } }));
    const mock: MockedResponse = {
      request: { query: ClearHabitDocument, variables: { habitId: 'habit-1', day: TODAY, today: TODAY } },
      result,
    };
    renderWithApollo(<HabitRow habit={water(1)} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Clear Water today$/));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('takes no press on any of its controls while a write is in flight', async () => {
    const { mock, result } = amountMock(
      { status: 'done', amount: 6, note: null, partial: false },
      water(6),
      IN_FLIGHT_MS,
    );
    renderWithApollo(<HabitRow habit={water(5)} today={TODAY} />, [mock]);

    await userEvent.click(done(/^One more of Water today$/));

    // Absolute totals, so a second press landing first would be overwritten by the first.
    for (const control of [
      done(/^One more of Water today$/),
      done(/^One less of Water today$/),
      done(/^Mark Water kept in full today$/),
      done(/^Skip Water today$/),
      amountBox(),
    ]) {
      expect(control).toBeDisabled();
    }
    const presser = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    await presser.click(done(/^One more of Water today$/));
    expect(result).not.toHaveBeenCalled();

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1), { timeout: IN_FLIGHT_MS * 3 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fills a short day with its tick, sending no amount', async () => {
    const { mock, result } = amountMock({ status: 'done' }, water(8));
    renderWithApollo(<HabitRow habit={water(5)} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Mark Water kept in full today$/));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('undoes a full day with its tick, as for any habit', async () => {
    const result = vi.fn(() => ({ data: { clearHabit: water() } }));
    const mock: MockedResponse = {
      request: { query: ClearHabitDocument, variables: { habitId: 'habit-1', day: TODAY, today: TODAY } },
      result,
    };
    renderWithApollo(<HabitRow habit={water(8)} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Undo Water for today$/));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('keeps the day’s amount when its smaller version is reworded', async () => {
    const { mock, result } = amountMock(
      { status: 'done', amount: 5, note: 'Out of glasses', partial: true },
      water(5, 'Out of glasses'),
    );
    renderWithApollo(<HabitRow habit={water(5, 'Tap water')} today={TODAY} />, [mock]);

    await userEvent.click(done(/^Reword the smaller version of Water today$/));
    const note = await screen.findByRole('textbox', { name: /what/i });
    await userEvent.clear(note);
    await userEvent.type(note, 'Out of glasses');
    await userEvent.click(screen.getByRole('button', { name: 'Keep the day' }));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });
});
