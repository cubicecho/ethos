import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { Minimize2, SkipForward } from '@/components/app-icons';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Check } from '@/components/ui/icons';
import { asPeriod, describeCadence, describeProgress } from '@/lib/cadence';
import { joinStats } from '@/lib/format';
import { habitPath } from '@/lib/habits';
import { readableTextColor } from '@/lib/readable-text-color';
import { cn } from '@/lib/utils';
import { SmallerVersionDialog } from './smaller-version-dialog';
import { asStatus, ENTRY_DONE, ENTRY_SKIPPED, type EntryStatus, type HabitSummary } from './types';
import { useMarkHabit } from './use-mark-habit';

/**
 * A habit as today sees it: a tick, a smaller version, a skip, and enough numbers to know
 * whether the tick is owed.
 *
 * The two controls are separate rather than a cycle — the grid cycles, because a
 * square has no room for two buttons — since the common action by far is
 * keeping the habit, and it should not be one click away from being undone by
 * the same button that did it. Both sit outside the part of the row that opens
 * the habit, which is what `ListItem`'s leading and action slots are for.
 */
export function HabitRow({ habit, today }: { habit: HabitSummary; today: string }) {
  const router = useRouter();
  const { setDay, markSmaller, isPending, error } = useMarkHabit(today);
  const [isNoting, setIsNoting] = useState(false);
  const entry = habit.todayEntry[0];
  const status = asStatus(entry?.status);
  const period = asPeriod(habit.period);
  const isDone = status === ENTRY_DONE;
  const isSkipped = status === ENTRY_SKIPPED;
  const isSmaller = isDone && entry?.partial === true;

  // A cue is a prompt, so it is shown only while there is something left to prompt.
  const cue = status === null ? habit.cue : null;

  const toggle = (next: EntryStatus) => setDay(habit.id, today, status === next ? null : next);

  return (
    <Card role="listitem" className="gap-1">
      <ListItem
        title={habit.name}
        description={joinStats(
          cue,
          isSmaller ? `Smaller version${entry?.note ? `: ${entry.note}` : ''}` : null,
          describeCadence(period, habit.targetCount),
          isSkipped ? 'Skipped today' : describeProgress(habit.current.done, habit.current.effectiveTarget, period),
        )}
        onPress={() => router.push(habitPath(habit.id))}
        leadingSlot={
          <ActionButton
            label={isDone ? `Undo ${habit.name} for today` : `Mark ${habit.name} kept today`}
            aria-pressed={isDone}
            disabled={isPending}
            variant="outline"
            size="icon-sm"
            onPress={() => toggle(ENTRY_DONE)}
            className={cn('rounded-full border-2', isDone && 'border-transparent')}
            // The habit's own colour, and whichever of black and white reads on it:
            // a theme token would be the wrong one in one theme or the other.
            style={isDone ? { backgroundColor: habit.color } : undefined}
            // Drawn only once kept: an empty ring is the "not yet", and a grey
            // tick inside it would read as half-done.
            iconSlot={
              <Check
                className={cn('h-5 w-5', isDone === false && 'opacity-0')}
                color={isDone ? readableTextColor(habit.color) : undefined}
              />
            }
          />
        }
        actionSlot={
          <View className="flex-row items-center gap-1">
            {/* A second way of keeping the day, not a third state: it opens a
                note, and the tick beside the name is still what undoes it. */}
            <ActionButton
              label={
                isSmaller
                  ? `Reword the smaller version of ${habit.name} today`
                  : `Did a smaller version of ${habit.name} today`
              }
              aria-pressed={isSmaller}
              disabled={isPending}
              variant={isSmaller ? 'secondary' : 'outline'}
              size="icon-sm"
              onPress={() => setIsNoting(true)}
              iconSlot={<Minimize2 />}
            />
            <ActionButton
              label={isSkipped ? `Un-skip ${habit.name} today` : `Skip ${habit.name} today`}
              aria-pressed={isSkipped}
              disabled={isPending}
              variant={isSkipped ? 'secondary' : 'outline'}
              size="icon-sm"
              onPress={() => toggle(ENTRY_SKIPPED)}
              iconSlot={<SkipForward />}
            />
          </View>
        }
      />

      {/* Beside the control that caused it: a refused skip is worth reading,
          and a toast in a corner is not where the click was. */}
      {error && isNoting === false ? (
        <Alert variant="destructive" className="mx-3 mb-3 w-auto" description={error} />
      ) : null}

      <SmallerVersionDialog
        open={isNoting}
        onOpenChange={setIsNoting}
        habitName={habit.name}
        note={isSmaller ? (entry?.note ?? null) : null}
        error={error}
        onSubmit={(note) => markSmaller(habit.id, today, note)}
      />
    </Card>
  );
}
