/** The detail screen's route for a habit. */
export const habitPath = (id: string) => `/habits/${id}` as const;

/** Where a new habit goes: after the last one, and first in an empty list. */
export function nextPosition(habits: readonly { position: number }[]): number {
  return habits.reduce((max, habit) => Math.max(max, habit.position), -1) + 1;
}
