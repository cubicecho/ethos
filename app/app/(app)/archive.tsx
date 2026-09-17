import { useQuery } from '@apollo/client';
import { Link } from 'expo-router';
import { HabitListItem } from '@/components/domain/habit/habit-list-item';
import { LoadFailure } from '@/components/ui/load-failure';
import { Spinner } from '@/components/ui/spinner';
import { ArchivedHabitsDocument } from '@/lib/graphql';
import { useToday } from '@/lib/use-today';

/**
 * Habits that have been put down.
 *
 * Nothing here acts on them: restoring and deleting both live on the habit's own
 * screen, where the rest of what is about to be restored or deleted is visible.
 * A row here is a way back to it.
 */
export default function ArchiveScreen() {
  const today = useToday();
  const { data, loading, error, refetch } = useQuery(ArchivedHabitsDocument, { variables: { today } });
  const habits = data?.habits ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="border-b pb-4">
        <h1 className="font-semibold text-2xl tracking-tight">Archive</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Every day recorded against these is still here. Open one to restore it.
        </p>
      </header>

      {loading && habits.length === 0 ? (
        <Spinner />
      ) : error && habits.length === 0 ? (
        <LoadFailure error={error} onRetry={refetch} />
      ) : habits.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing archived. <Link href="/">Back to today.</Link>
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {habits.map((habit) => (
            <HabitListItem key={habit.id} id={habit.id} name={habit.name} color={habit.color} active={false} />
          ))}
        </div>
      )}
    </div>
  );
}
