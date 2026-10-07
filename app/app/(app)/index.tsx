import { useQuery } from '@apollo/client';
import { useState } from 'react';
import { View } from 'react-native';
import { CalendarCheck } from '@/components/app-icons';
import { HabitFormDialog } from '@/components/domain/habit/habit-form-dialog';
import { HabitRow } from '@/components/domain/habit/habit-row';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { LoadState } from '@/components/ui/load-failure';
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
  const habitsQuery = useQuery(HabitsDocument, { variables: { today } });
  const [creating, setCreating] = useState(false);
  // Read during render rather than through state: the list is the source, and a
  // position kept in state would go stale the moment a habit was added.
  const habits = habitsQuery.data?.habits ?? [];
  const nextPosition = habits.reduce((max, habit) => Math.max(max, habit.position), -1) + 1;

  useHotkey('n', (event) => {
    event.preventDefault();
    setCreating(true);
  });

  return (
    <>
      <PageLayout
        width="prose"
        title="Today"
        description={formatDayLong(today)}
        actionSlot={
          <Button
            size="sm"
            onPress={() => setCreating(true)}
            iconSlot={<Plus className="size-4" />}
            content="New habit"
          />
        }
        contentSlot={
          <View className="gap-2 py-6">
            {/* Only when there is nothing to show. A refetch that fails while the
                list is on screen leaves it there — the marks already made are
                still true, and replacing them with an apology helps nobody. */}
            <LoadState
              query={habitsQuery}
              what="your habits"
              count={habits.length}
              emptySlot={
                <EmptyState
                  icon={CalendarCheck}
                  title="Nothing to keep yet"
                  description="A habit is a thing you mean to do, and how often. Start with one."
                  actionSlot={<Button onPress={() => setCreating(true)} content="Create a habit" />}
                />
              }
            />
            {habits.length > 0 ? (
              <View role="list" className="gap-2">
                {habits.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} today={today} />
                ))}
              </View>
            ) : null}
          </View>
        }
      />
      <HabitFormDialog open={creating} onOpenChange={setCreating} today={today} nextPosition={nextPosition} />
    </>
  );
}
