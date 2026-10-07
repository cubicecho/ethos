import { useQuery } from '@apollo/client';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { BackToTodayLink } from '@/components/domain/habit/back-to-today-link';
import { HabitGrid } from '@/components/domain/habit/habit-grid';
import { HabitPage } from '@/components/domain/habit/habit-page';
import { useMarkHabitDay } from '@/components/domain/habit/use-mark-habit';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { Section } from '@/components/section';
import { Search } from '@/components/ui/icons';
import { LoadState } from '@/components/ui/load-failure';
import { HabitDocument } from '@/lib/graphql';
import { useToday } from '@/lib/use-today';

export default function HabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const habitQuery = useQuery(HabitDocument, {
    variables: { id: id as string, today },
    skip: !id,
  });
  const { setDay, isPending, error: markError } = useMarkHabitDay(today);

  const habit = habitQuery.data?.habit;
  if (!habit) {
    return (
      <PageLayout
        width="prose"
        title="Habit"
        contentSlot={
          // The failure goes ahead of not-found: with the API unreachable, telling
          // someone their habit is gone when it is not is worse than telling nothing.
          <LoadState
            query={habitQuery}
            what="this habit"
            count={0}
            emptySlot={
              <EmptyState
                icon={Search}
                title="That habit doesn't exist, or isn't yours."
                actionSlot={<BackToTodayLink />}
              />
            }
          />
        }
      />
    );
  }

  return (
    <HabitPage
      habit={habit}
      today={today}
      contentSlot={
        <Section
          title="History"
          description="Press a day: kept, skipped, then neither."
          contentSlot={
            <>
              <HabitGrid
                habit={habit}
                history={habit.history}
                entries={habit.entries}
                today={today}
                isPending={isPending}
                onSet={(day, status) => setDay(habit.id, day, status)}
              />
              {markError ? (
                <Text className="mt-3 text-negative text-sm" aria-live="polite">
                  {markError}
                </Text>
              ) : null}
            </>
          }
        />
      }
    />
  );
}
