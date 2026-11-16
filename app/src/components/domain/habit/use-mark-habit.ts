import { type TypedDocumentNode, useMutation } from '@apollo/client';
import { useState } from 'react';
import { describeError } from '@/lib/errors';
import {
  ClearHabitDayDocument,
  ClearHabitDocument,
  ClearHabitOverviewDocument,
  MarkHabitDayDocument,
  MarkHabitDocument,
  MarkHabitOverviewDocument,
} from '@/lib/graphql';
import { type DayStatus, ENTRY_DONE } from './types';

/**
 * Recording a day, and what it costs to get wrong.
 *
 * Nothing here answers optimistically. A tick changes the period's tally and
 * whether it was met, and a skip can be refused at the cap, all decided by the
 * server from rows the client does not hold. A tally the client invented and the
 * server then corrected is worse than one that arrives a moment late, so
 * `isPending` says the control is working instead.
 */
export interface Marker {
  /** `null` clears the day, leaving it untouched rather than missed. */
  setDay: (habitId: string, day: string, status: DayStatus) => Promise<void>;
  /**
   * Keeps the day as a smaller version, with what was done instead. `amount` keeps a short day's
   * amount, so rewording the note on 5 of 8 is still 5. Resolves to whether it was recorded.
   */
  markSmaller: (habitId: string, day: string, note: string | null, amount?: number) => Promise<boolean>;
  /**
   * Records how much of the habit the day held, as a total: 0 clears the day. The note is sent
   * again because every mark rewrites it, and `partial` is left to the server, which reads it
   * off the amount.
   */
  setAmount: (habitId: string, day: string, amount: number, note: string | null) => Promise<void>;
  isPending: boolean;
  error: string | null;
}

/**
 * Runs an action, tracking whether it is pending and why the last one failed.
 *
 * @returns The pending flag, the last error as a sentence, and `run`.
 */
function useAction() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Caught rather than rethrown: every caller is a button, and the server's
  // refusals — a third skip, a day that has not happened — are worth reading.
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setIsPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(describeError(cause));
      return false;
    } finally {
      setIsPending(false);
    }
  }

  return { isPending, error, run };
}

type DayVariables = { habitId: string; day: string };

/** What every mark on a screen is sent with: the caller's day, and whatever else its selection reads. */
type SharedVariables = { today: string };

/** What a mark says about the day beyond which day it is. */
type MarkVariables = {
  status?: string | null;
  note?: string | null;
  partial?: boolean | null;
  /** How much the day held, as a total. Left out, a kept day is the habit's whole daily amount. */
  amount?: number | null;
};

/** The two mutations a screen records a day with. Their results differ; what they are sent does not. */
interface MarkDocuments<TShared extends SharedVariables> {
  mark: TypedDocumentNode<unknown, DayVariables & TShared & MarkVariables>;
  clear: TypedDocumentNode<unknown, DayVariables & TShared>;
}

/**
 * Builds a marker over a pair of mutations.
 *
 * @param documents - The mark and clear mutations to send.
 * @param shared - The variables both are sent beside the habit and the day.
 * @returns The marker.
 */
function useMarker<TShared extends SharedVariables>(documents: MarkDocuments<TShared>, shared: TShared): Marker {
  const [mark] = useMutation(documents.mark);
  const [clear] = useMutation(documents.clear);
  const { isPending, error, run } = useAction();

  return {
    isPending,
    error,
    setDay: async (habitId, day, status) => {
      await run(() =>
        status === null
          ? clear({ variables: { habitId, day, ...shared } })
          : mark({ variables: { habitId, day, status, ...shared } }),
      );
    },
    markSmaller: (habitId, day, note, amount) =>
      run(() =>
        mark({
          // Left out rather than sent as null when there is none: a mark with no amount is a whole day.
          variables: {
            habitId,
            day,
            status: ENTRY_DONE,
            note,
            partial: true,
            ...(amount === undefined ? {} : { amount }),
            ...shared,
          },
        }),
      ),
    setAmount: async (habitId, day, amount, note) => {
      await run(() =>
        amount === 0
          ? clear({ variables: { habitId, day, ...shared } })
          : mark({ variables: { habitId, day, status: ENTRY_DONE, amount, note, partial: false, ...shared } }),
      );
    },
  };
}

/**
 * For screens that show a habit but no history: the list.
 *
 * @param today - The caller's day.
 * @returns The marker.
 */
export function useMarkHabit(today: string): Marker {
  return useMarker({ mark: MarkHabitDocument, clear: ClearHabitDocument }, { today });
}

/**
 * For the detail screen. Same two mutations, selecting the grid as well — the
 * duplication is in the documents and explained there: a screen asks back for
 * exactly what it is showing.
 *
 * @param today - The caller's day.
 * @returns The marker.
 */
export function useMarkHabitDay(today: string): Marker {
  return useMarker({ mark: MarkHabitDayDocument, clear: ClearHabitDayDocument }, { today });
}

/** The caller's day and the span the overview is drawing, as its documents name them. */
export interface OverviewVariables {
  today: string;
  /** The span's first day. */
  from: string;
  /** The day after the span's last: exclusive. */
  to: string;
}

/**
 * For the overview. The same two mutations again, selecting the span's days so
 * a mark lands in the row that is already on screen.
 *
 * @param variables - The caller's day and the span being drawn.
 * @returns The marker.
 */
export function useMarkHabitOverview(variables: OverviewVariables): Marker {
  return useMarker({ mark: MarkHabitOverviewDocument, clear: ClearHabitOverviewDocument }, variables);
}
