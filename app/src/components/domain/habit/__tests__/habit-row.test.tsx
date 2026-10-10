import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClearHabitDocument, MarkHabitDocument } from '@/lib/graphql';
import { entry, habit, renderWithApollo, TODAY, tally } from '../../__tests__/helpers';
import { HabitRow } from '../habit-row';

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
    // left, and the row would read that failure out.
    await userEvent.click(done(/^Skip Read today$/));
    await userEvent.click(done(/^Mark Read kept today$/));
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
});
