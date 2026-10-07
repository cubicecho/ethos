import { type TypedDocumentNode, useMutation } from '@apollo/client';
import { useState } from 'react';
import { describeError } from '@/lib/errors';
import { ClearHabitDayDocument, ClearHabitDocument, MarkHabitDayDocument, MarkHabitDocument } from '@/lib/graphql';
import type { DayStatus } from './types';

/**
 * Recording a day, and what it costs to get wrong.
 *
 * Nothing here answers optimistically. A tick changes the streak, the tally and
 * whether the period was met, all derived by the server from rows the client
 * does not hold. A streak the client invented and the server then corrected is
 * worse than one that arrives a moment late, so `isPending` says the control is
 * working instead.
 */
export interface Marker {
  /** `null` clears the day, leaving it untouched rather than missed. */
  setDay: (habitId: string, day: string, status: DayStatus) => Promise<void>;
  isPending: boolean;
  error: string | null;
}

function useAction() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Caught rather than rethrown: every caller is a button, and the server's
  // refusals — a third skip, a day that has not happened — are worth reading.
  async function run(action: () => Promise<unknown>): Promise<void> {
    setIsPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setIsPending(false);
    }
  }

  return { isPending, error, run };
}

type DayVariables = { habitId: string; day: string; today: string };

/** The two mutations a screen records a day with. Their results differ; what they are sent does not. */
interface MarkDocuments {
  mark: TypedDocumentNode<unknown, DayVariables & { status?: string | null }>;
  clear: TypedDocumentNode<unknown, DayVariables>;
}

function useMarker(documents: MarkDocuments, today: string): Marker {
  const [mark] = useMutation(documents.mark);
  const [clear] = useMutation(documents.clear);
  const { isPending, error, run } = useAction();

  return {
    isPending,
    error,
    setDay: (habitId, day, status) =>
      run(() =>
        status === null
          ? clear({ variables: { habitId, day, today } })
          : mark({ variables: { habitId, day, status, today } }),
      ),
  };
}

/** For screens that show a habit but no history: the list. */
export function useMarkHabit(today: string): Marker {
  return useMarker({ mark: MarkHabitDocument, clear: ClearHabitDocument }, today);
}

/**
 * For the detail screen. Same two mutations, selecting the grid as well — the
 * duplication is in the documents and explained there: a screen asks back for
 * exactly what it is showing.
 */
export function useMarkHabitDay(today: string): Marker {
  return useMarker({ mark: MarkHabitDayDocument, clear: ClearHabitDayDocument }, today);
}
