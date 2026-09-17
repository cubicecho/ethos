import { useQuery } from '@apollo/client';
import { useLocalSearchParams } from 'expo-router';
import { HabitGrid } from '@/components/domain/habit/habit-grid';
import { HabitOverview } from '@/components/domain/habit/habit-overview';
import { useMarkHabitDay } from '@/components/domain/habit/use-mark-habit';
import { LoadFailure } from '@/components/ui/load-failure';
import { Spinner } from '@/components/ui/spinner';
import { HabitDocument } from '@/lib/graphql';
import { useToday } from '@/lib/use-today';

export default function HabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const { data, loading, error, refetch } = useQuery(HabitDocument, {
    variables: { id: id as string, today },
    skip: !id,
  });
  const { setDay, pending, error: markError } = useMarkHabitDay(today);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Ahead of the not-found message, which is a claim about the caller's own
  // data: with the API unreachable the app has no idea whose the habit is, and
  // telling someone their habit is gone when it is not is worse than telling
  // them nothing.
  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <LoadFailure error={error} onRetry={refetch} />
      </div>
    );
  }

  const habit = data?.habit;
  if (!habit) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-muted-foreground text-sm">That habit doesn't exist, or isn't yours.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <HabitOverview habit={habit} today={today} />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-sm">History</h2>
          <p className="text-muted-foreground text-xs">Click a day: kept, skipped, then neither.</p>
        </div>

        <HabitGrid
          habit={habit}
          history={habit.history}
          entries={habit.entries}
          today={today}
          pending={pending}
          onSet={(day, status) => setDay(habit.id, day, status)}
        />

        {markError ? (
          <p className="text-destructive text-sm" aria-live="polite">
            {markError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
