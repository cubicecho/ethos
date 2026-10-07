import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { Flame, SkipForward } from '@/components/app-icons';
import { ListItem } from '@/components/list-item';
import { Badge } from '@/components/ui/badge';
import { Check } from '@/components/ui/icons';
import { describeCadence, describeProgress } from '@/lib/cadence';
import type { Period } from '@/lib/periods';
import { readableTextColor } from '@/lib/readable-text-color';
import { cn } from '@/lib/utils';
import { asStatus, type HabitSummary } from './types';
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
  const period = habit.period as Period;
  const isDone = status === 'done';
  const isSkipped = status === 'skipped';

  const toggle = (next: 'done' | 'skipped') => setDay(habit.id, today, status === next ? null : next);

  return (
    <View role="listitem" className="gap-1 rounded-lg border border-border bg-card">
      <ListItem
        title={habit.name}
        description={`${describeCadence(period, habit.targetCount)} · ${
          isSkipped ? 'Skipped today' : describeProgress(habit.current.done, habit.current.effectiveTarget, period)
        }`}
        onPress={() => router.push(`/habits/${habit.id}`)}
        leadingSlot={
          <ActionButton
            label={isDone ? `Undo ${habit.name} for today` : `Mark ${habit.name} kept today`}
            aria-pressed={isDone}
            disabled={isPending}
            variant="outline"
            size="icon-sm"
            onPress={() => toggle('done')}
            className={cn('rounded-full border-2', isDone && 'border-transparent')}
            // The habit's own colour, and whichever of black and white reads on it:
            // a theme token would be the wrong one in one theme or the other.
            style={isDone ? { backgroundColor: habit.color } : undefined}
            // Drawn only once kept: an empty ring is the "not yet", and a grey
            // tick inside it would read as half-done.
            iconSlot={
              <Check
                className={cn('h-5 w-5', !isDone && 'opacity-0')}
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
            onPress={() => toggle('skipped')}
            iconSlot={<SkipForward />}
          />
        }
      />

      {/* Beside the control that caused it. A skip refused because the period
          has had its two is worth reading, and a toast in a corner is not where
          the click was. */}
      {error ? (
        <Text className="pb-2.5 pl-16 text-negative text-xs" aria-live="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
