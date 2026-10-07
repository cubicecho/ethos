import { useMutation } from '@apollo/client';
import { useState } from 'react';
import { describeError } from '@/lib/errors';
import { ClearHabitDayDocument, ClearHabitDocument, MarkHabitDayDocument, MarkHabitDocument } from '@/lib/graphql';
import type { DayStatus } from './types';

/**
 * Recording a day, and what it costs to get wrong.
 *
 * Nothing here answers optimistically. A tick changes the streak, the period's
 * tally and whether it was met — all of them derived by the server from rows the
 * client does not hold — so an optimistic answer would mean reimplementing
 * `server/src/streaks.ts` here and hoping the two agree. Day arithmetic is
 * duplicated deliberately (`src/lib/periods.ts`); the counting is not, because a
 * streak the client invented and the server then corrected is worse than a
 * streak that arrives a moment late.
 *
 * `pending` is the replacement: the control says it is working rather than
 * pretending it is done.
 */
export interface Marker {
  /** `null` clears the day, leaving it untouched rather than missed. */
  setDay: (habitId: string, day: string, status: DayStatus) => Promise<void>;
  pending: boolean;
  error: string | null;
}

function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Caught rather than rethrown: every caller is a button, and a rejected click
  // with nothing on screen is the failure mode this replaces. The server refuses
  // real things — a third skip in one week, a day that has not happened — and
  // those refusals are worth reading.
  async function run(action: () => Promise<unknown>): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run };
}

/** For screens that show a habit but no history — the list and the sidebar. */
export function useMarkHabit(today: string): Marker {
  const [mark] = useMutation(MarkHabitDocument);
  const [clear] = useMutation(ClearHabitDocument);
  const { pending, error, run } = useAction();

  return {
    pending,
    error,
    setDay: (habitId, day, status) =>
      run(() =>
        status === null
          ? clear({ variables: { habitId, day, today } })
          : mark({ variables: { habitId, day, status, today } }),
      ),
  };
}

/**
 * For the detail screen. Same two mutations, selecting the grid as well — the
 * duplication is in the documents and explained there: a screen asks back for
 * exactly what it is showing.
 */
export function useMarkHabitDay(today: string): Marker {
  const [mark] = useMutation(MarkHabitDayDocument);
  const [clear] = useMutation(ClearHabitDayDocument);
  const { pending, error, run } = useAction();

  return {
    pending,
    error,
    setDay: (habitId, day, status) =>
      run(() =>
        status === null
          ? clear({ variables: { habitId, day, today } })
          : mark({ variables: { habitId, day, status, today } }),
      ),
  };
}
