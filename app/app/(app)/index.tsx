import { useQuery } from '@apollo/client';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { HabitFormDialog } from '@/components/domain/habit/habit-form-dialog';
import { HabitRow } from '@/components/domain/habit/habit-row';
import { Button } from '@/components/ui/button';
import { LoadFailure } from '@/components/ui/load-failure';
import { Spinner } from '@/components/ui/spinner';
import { HabitsDocument } from '@/lib/graphql';
import { useHotkey } from '@/lib/hotkeys';
import { formatDayLong } from '@/lib/periods';
import { useToday } from '@/lib/use-today';

/**
 * Today. The whole app, most days.
 *
 * Every habit is here whether or not it is owed today — a habit kept three times
 * a week is owed on no particular day, and hiding it until some scheduler
 * decides it is due would make the app the one choosing which days count.
 */
export default function TodayScreen() {
  const today = useToday();
  const { data, loading, error, refetch } = useQuery(HabitsDocument, { variables: { today } });
  const [creating, setCreating] = useState(false);
  // Read during render rather than through state: the list is the source, and a
  // position kept in state would go stale the moment a habit was added.
  const habits = data?.habits ?? [];
  const nextPosition = useRef(0);
  nextPosition.current = habits.reduce((max, habit) => Math.max(max, habit.position), -1) + 1;

  useHotkey('n', (event) => {
    event.preventDefault();
    setCreating(true);
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex items-end justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Today</h1>
          <p className="mt-1 text-muted-foreground text-sm">{formatDayLong(today)}</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New habit
        </Button>
      </header>

      {loading && habits.length === 0 ? (
        <Spinner />
      ) : error && habits.length === 0 ? (
        // Only when there is nothing to show. A refetch that fails while the
        // list is on screen should leave it there — the marks already made are
        // still true, and replacing them with an apology helps nobody.
        <LoadFailure error={error} onRetry={refetch} />
      ) : habits.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-8">
          <div>
            <h2 className="font-semibold text-lg">Nothing to keep yet</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              A habit is a thing you mean to do, and how often. Start with one.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>Create a habit</Button>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {habits.map((habit) => (
            <HabitRow key={habit.id} habit={habit} today={today} />
          ))}
        </ul>
      )}

      <HabitFormDialog open={creating} onOpenChange={setCreating} today={today} nextPosition={nextPosition.current} />
    </div>
  );
}
