import type { HabitEntryFieldsFragment, HabitFieldsFragment, HabitPeriodFieldsFragment } from '@/__generated__/graphql';

/**
 * What the screens pass around.
 *
 * The fragments are the contract — every document selects one of them — so
 * naming the generated fragment types here is what keeps a component's props
 * and the query that feeds it the same shape. A field dropped from a fragment
 * becomes a type error at the component reading it, rather than an `undefined`
 * at runtime.
 */
export type HabitSummary = HabitFieldsFragment;
export type HabitPeriodSummary = HabitPeriodFieldsFragment;
export type HabitEntrySummary = HabitEntryFieldsFragment;

/** What a day says, or nothing at all — the three states a square can be in. */
export type DayStatus = 'done' | 'skipped' | null;

/** The status of a day, narrowed from the `String` the schema serves. */
export function asStatus(value: string | null | undefined): DayStatus {
  return value === 'done' || value === 'skipped' ? value : null;
}

/**
 * What clicking a square does: nothing → kept → skipped → nothing.
 *
 * One control rather than three, because a square is too small for three, and
 * the cycle puts every state one or two clicks away with no hidden menu. Undo
 * is the third click, which is why "nothing" is in the cycle rather than behind
 * a separate clear.
 */
export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) {
    return 'done';
  }
  return current === 'done' ? 'skipped' : null;
}
