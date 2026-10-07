import { useRouter } from 'expo-router';
import { ActionButton } from '@/components/action-button';
import { Flame, SkipForward } from '@/components/app-icons';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Check } from '@/components/ui/icons';
import { asPeriod, describeCadence, describeProgress } from '@/lib/cadence';
import { joinStats } from '@/lib/format';
import { habitPath } from '@/lib/habits';
import { readableTextColor } from '@/lib/readable-text-color';
import { cn } from '@/lib/utils';
import { asStatus, ENTRY_DONE, ENTRY_SKIPPED, type EntryStatus, type HabitSummary } from './types';
import { useMarkHabit } from './use-mark-habit';

/**
 * A habit as today sees it: one tick, one skip, and enough numbers to know
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
  const { setDay, isPending, error } = useMarkHabit(today);
  const status = asStatus(habit.todayEntry[0]?.status);
  const period = asPeriod(habit.period);
  const isDone = status === ENTRY_DONE;
  const isSkipped = status === ENTRY_SKIPPED;

  const toggle = (next: EntryStatus) => setDay(habit.id, today, status === next ? null : next);

  return (
    <Card role="listitem" className="gap-1">
      <ListItem
        title={habit.name}
        description={joinStats(
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
        meta={
          habit.streak > 0 ? (
            <Badge variant="secondary" label={`${habit.streak} ${period}s in a row`}>
              <Flame />
              {habit.streak}
            </Badge>
          ) : undefined
        }
        actionSlot={
          <ActionButton
            label={isSkipped ? `Un-skip ${habit.name} today` : `Skip ${habit.name} today`}
            aria-pressed={isSkipped}
            disabled={isPending}
            variant={isSkipped ? 'secondary' : 'ghost'}
            size="icon-sm"
            onPress={() => toggle(ENTRY_SKIPPED)}
            iconSlot={<SkipForward />}
          />
        }
      />

      {/* Beside the control that caused it: a refused skip is worth reading,
          and a toast in a corner is not where the click was. */}
      {error ? <Alert variant="destructive" className="mx-3 mb-3 w-auto" description={error} /> : null}
    </Card>
  );
}
