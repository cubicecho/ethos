import type { ApolloCache } from '@apollo/client';
import type { HabitsQuery } from '@/__generated__/graphql';
import { ArchivedHabitsDocument, HabitsDocument } from './graphql';

/** A habit exactly as the lists hold it in the cache. */
export type CachedHabit = HabitsQuery['habits'][number];

/**
 * Where a habit is listed, and the only thing that decides it: `archivedAt`.
 *
 * The two queries are complementary halves of one set — `isNull` and
 * `isNotNull` on the same column — so every write that touches that column is a
 * move between them. Keeping the pair in one place is what stops a habit being
 * archived out of the sidebar and still sitting in the archive's cache as
 * active, or worse, appearing in both.
 */
function listsOf(today: string) {
  return {
    active: { query: HabitsDocument, variables: { today } },
    archived: { query: ArchivedHabitsDocument, variables: { today } },
  };
}

function without(habits: readonly CachedHabit[], id: string): CachedHabit[] {
  return habits.filter((habit) => habit.id !== id);
}

/**
 * Put a habit in the list its `archivedAt` says it belongs to, and take it out
 * of the other one.
 *
 * Appended to the active list rather than sorted into it: that query orders by
 * `position`, and a new habit is created at the end, so appending is the order
 * a refetch would come back with. The archive reads newest-first, so a habit
 * just archived goes to the front for the same reason.
 *
 * A no-op for a list that is not in the cache, which is the case for the
 * archive until someone opens it — `updateQuery` leaves a missing entry alone
 * rather than writing a partial one that the next read would trust.
 */
export function placeHabit(cache: ApolloCache<unknown>, today: string, habit: CachedHabit): void {
  const { active, archived } = listsOf(today);
  const isArchived = habit.archivedAt != null;

  cache.updateQuery(active, (existing) =>
    existing
      ? {
          ...existing,
          habits: isArchived ? without(existing.habits, habit.id) : [...without(existing.habits, habit.id), habit],
        }
      : existing,
  );
  cache.updateQuery(archived, (existing) =>
    existing
      ? {
          ...existing,
          habits: isArchived ? [habit, ...without(existing.habits, habit.id)] : without(existing.habits, habit.id),
        }
      : existing,
  );
}

/** Drop a habit from both lists — what a delete leaves behind is nothing. */
export function removeHabit(cache: ApolloCache<unknown>, today: string, id: string): void {
  const { active, archived } = listsOf(today);
  for (const list of [active, archived]) {
    cache.updateQuery(list, (existing) =>
      existing ? { ...existing, habits: without(existing.habits, id) } : existing,
    );
  }
  // The lists were the only references. Left in the cache, a screen still
  // holding the id would read a habit the server no longer has.
  cache.evict({ id: cache.identify({ __typename: 'Habit', id }) });
  cache.gc();
}
