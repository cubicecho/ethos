import { useMutation } from '@apollo/client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { Archive, ArchiveRestore } from '@/components/app-icons';
import { ConfirmButton } from '@/components/confirm-button';
import { PageLayout } from '@/components/page-layout';
import { StatTile } from '@/components/stat-tile';
import { Alert } from '@/components/ui/alert';
import { ColorDot } from '@/components/ui/color-dot';
import { Pencil, Trash2 } from '@/components/ui/icons';
import { placeHabit, removeHabit } from '@/lib/cache';
import { asPeriod, describeCadence } from '@/lib/cadence';
import { describeError } from '@/lib/errors';
import { joinStats } from '@/lib/format';
import { DeleteHabitDocument, UpdateHabitDocument } from '@/lib/graphql';
import { THIS_PERIOD } from '@/lib/periods';
import type { SlotNode } from '@/lib/utils';
import { HabitFormDialog } from './habit-form-dialog';
import type { HabitSummary } from './types';

/**
 * A habit's own screen: its name, cadence and actions in the page header, the
 * three numbers under it, and whatever the route puts below them.
 */
export function HabitPage({
  habit,
  today,
  contentSlot,
}: {
  habit: HabitSummary;
  today: string;
  contentSlot: SlotNode;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updateHabit] = useMutation(UpdateHabitDocument);
  const [deleteHabit] = useMutation(DeleteHabitDocument);

  const period = asPeriod(habit.period);
  const isArchived = habit.archivedAt != null;

  /**
   * Archiving is the ordinary way to stop a habit, and it is a plain column
   * update — so it is the generated mutation, not one written for the occasion.
   * The days stay, which is the whole point: a habit put down after a year is a
   * year of days worth keeping, and the archive is where it is un-put-down from.
   */
  async function setArchived(next: boolean) {
    setActionError(null);
    try {
      await updateHabit({
        variables: { id: habit.id, set: { archivedAt: next ? new Date().toISOString() : null }, today },
        update(cache, { data }) {
          if (data?.updateHabit) {
            placeHabit(cache, today, data.updateHabit);
          }
        },
      });
    } catch (cause) {
      setActionError(describeError(cause));
    }
  }

  async function remove() {
    setActionError(null);
    try {
      await deleteHabit({
        variables: { id: habit.id },
        update: (cache) => removeHabit(cache, today, habit.id),
      });
    } catch (cause) {
      // Stay put. Navigating away from a habit that is still there would look
      // like the delete worked.
      setActionError(describeError(cause));
      return;
    }
    router.replace('/');
  }

  return (
    <>
      <PageLayout
        width="prose"
        title={habit.name}
        description={joinStats(describeCadence(period, habit.targetCount), isArchived && 'Archived')}
        // The habit's colour is how it is recognised on every other screen.
        iconSlot={<ColorDot color={habit.color} />}
        actionSlot={
          <>
            <ActionButton
              label="Edit habit"
              variant="outline"
              size="icon"
              onPress={() => setIsEditing(true)}
              iconSlot={<Pencil />}
            />
            <ActionButton
              label={isArchived ? 'Restore habit' : 'Archive habit'}
              variant="outline"
              size="icon"
              onPress={() => void setArchived(isArchived === false)}
              iconSlot={isArchived ? <ArchiveRestore /> : <Archive />}
            />
            <ConfirmButton
              label="Delete habit"
              variant="destructive-outline"
              size="icon"
              iconSlot={<Trash2 />}
              title={`Delete “${habit.name}”?`}
              description="Every day recorded against it goes too. Archiving keeps them, and puts the habit away."
              confirmLabel="Delete"
              onConfirm={() => void remove()}
            />
          </>
        }
        contentClassName="gap-6 py-6"
        contentSlot={
          <>
            {habit.notes ? <Text className="text-foreground text-sm">{habit.notes}</Text> : null}

            <View className="flex-row flex-wrap gap-3">
              <StatTile className="min-w-32 flex-1" label="Streak" value={habit.streak} hint={`${period}s in a row`} />
              <StatTile className="min-w-32 flex-1" label="Best" value={habit.longestStreak} />
              <StatTile
                className="min-w-32 flex-1"
                label={THIS_PERIOD[period]}
                value={`${habit.current.done}/${habit.current.effectiveTarget}`}
                hint={
                  habit.current.skipped > 0
                    ? `${habit.current.skipped} skipped, and skips come off the target`
                    : undefined
                }
              />
            </View>

            {actionError ? <Alert variant="destructive" description={actionError} /> : null}

            {contentSlot}
          </>
        }
      />
      <HabitFormDialog open={isEditing} onOpenChange={setIsEditing} today={today} habit={habit} />
    </>
  );
}
