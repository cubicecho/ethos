import { useQuery } from '@apollo/client';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Archive } from '@/components/app-icons';
import { BackToTodayLink } from '@/components/domain/habit/back-to-today-link';
import { ListItem } from '@/components/list-item';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { ColorDot } from '@/components/ui/color-dot';
import { LoadState } from '@/components/ui/load-failure';
import { asPeriod, describeCadence } from '@/lib/cadence';
import { ArchivedHabitsDocument } from '@/lib/graphql';
import { habitPath } from '@/lib/habits';
import { useToday } from '@/lib/use-today';

/**
 * Habits that have been put down.
 *
 * Nothing here acts on them: restoring and deleting both live on the habit's own
 * screen, where the rest of what is about to be restored or deleted is visible.
 * A row here is a way back to it.
 */
export default function ArchiveScreen() {
  const router = useRouter();
  const today = useToday();
  const archivedQuery = useQuery(ArchivedHabitsDocument, { variables: { today } });
  const habits = archivedQuery.data?.habits ?? [];

  return (
    <PageLayout
      width="prose"
      title="Archive"
      description="Every day recorded against these is still here. Open one to restore it."
      contentSlot={
        <View className="py-6">
          <LoadState
            query={archivedQuery}
            what="the archive"
            count={habits.length}
            emptySlot={<EmptyState icon={Archive} title="Nothing archived" actionSlot={<BackToTodayLink />} />}
          />
          {habits.length > 0 ? (
            <View role="list" className="gap-0.5">
              {habits.map((habit) => (
                <View key={habit.id} role="listitem">
                  <ListItem
                    title={habit.name}
                    description={describeCadence(asPeriod(habit.period), habit.targetCount)}
                    leadingSlot={<ColorDot color={habit.color} />}
                    onPress={() => router.push(habitPath(habit.id))}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      }
    />
  );
}
