import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Minimize2 } from '@/components/app-icons';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Check, SkipForward } from '@/components/ui/icons';
import { asPeriod, describeAmount, describeCadence, describeProgress } from '@/lib/cadence';
import { joinStats } from '@/lib/format';
import { habitPath } from '@/lib/habits';
import { Period } from '@/lib/periods';
import { readableTextColor } from '@/lib/readable-text-color';
import { cn } from '@/lib/utils';
import { AmountStepper } from './amount-stepper';
import { SmallerVersionDialog } from './smaller-version-dialog';
import { asStatus, type DayStatus, ENTRY_DONE, ENTRY_SKIPPED, type EntryStatus, type HabitSummary } from './types';
import { useMarkHabit } from './use-mark-habit';

/**
 * What the tick beside the name does, as its label.
 *
 * @param name - The habit's name.
 * @param isDone - Whether today is kept.
 * @param isShort - Whether today is kept but short of the habit's daily amount.
 * @returns The label.
 */
function tickLabelOf(name: string, isDone: boolean, isShort: boolean): string {
  if (isShort) {
    return `Mark ${name} kept in full today`;
  }
  return isDone ? `Undo ${name} for today` : `Mark ${name} kept today`;
}

/**
 * A habit as today sees it: a tick, a smaller version, a skip, and enough numbers to know
 * whether the tick is owed.
 *
 * The two controls are separate rather than a cycle — the grid cycles, because a
 * square has no room for two buttons — since the common action by far is
 * keeping the habit, and it should not be one click away from being undone by
 * the same button that did it. Both sit outside the part of the row that opens
 * the habit, which is what `ListItem`'s leading and action slots are for. A habit
 * that asks for more than one of something a day adds a stepper for how many.
 */
export function HabitRow({ habit, today }: { habit: HabitSummary; today: string }) {
  const router = useRouter();
  const { setDay, markSmaller, setAmount, isPending, error } = useMarkHabit(today);
  const [isNoting, setIsNoting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const entry = habit.todayEntry[0];
  const status = asStatus(entry?.status);
  const period = asPeriod(habit.period);
  const isDone = status === ENTRY_DONE;
  const isSkipped = status === ENTRY_SKIPPED;
  const isSmaller = isDone && entry?.partial === true;
  const hasAmount = habit.dailyAmount > 1;
  const amount = isDone ? (entry?.amount ?? 0) : 0;
  // A short day is kept and counted, so its tick fills it rather than undoing it.
  const isShort = hasAmount && isDone && amount < habit.dailyAmount;
  // Measured against what the day was written against, which outlives a change to the habit.
  const amountToday = describeAmount(amount, isDone ? (entry?.dailyAmount ?? habit.dailyAmount) : habit.dailyAmount);
  // A daily habit's period is today, so its amount already says how today stands.
  const periodProgress =
    hasAmount && period === Period.Day
      ? null
      : describeProgress(habit.current.done, habit.current.effectiveTarget, period);
  const tickLabel = tickLabelOf(habit.name, isDone, isShort);

  // A cue is a prompt, so it is shown only while there is something left to prompt.
  const cue = status === null ? habit.cue : null;

  const record = (next: DayStatus) => {
    setRefusal(null);
    return setDay(habit.id, today, next);
  };
  const toggle = (next: EntryStatus) => record(status === next ? null : next);
  // A mark with no amount is the whole amount, so filling a short day is a plain tick.
  const tick = () => (isShort ? record(ENTRY_DONE) : toggle(ENTRY_DONE));
  const changeAmount = (next: number) => {
    setRefusal(null);
    // Every mark rewrites the note, so a kept day's is sent again.
    return setAmount(habit.id, today, next, isDone ? (entry?.note ?? null) : null);
  };

  return (
    <Card role="listitem" className="gap-1">
      <ListItem
        title={habit.name}
        description={joinStats(
          cue,
          isSmaller ? `Smaller version${entry?.note ? `: ${entry.note}` : ''}` : null,
          describeCadence(period, habit.targetCount, habit.dailyAmount),
          hasAmount && isSkipped === false && `${amountToday} today`,
          isSkipped ? 'Skipped today' : periodProgress,
        )}
        onPress={() => router.push(habitPath(habit.id))}
        leadingSlot={
          <Button
            aria-label={tickLabel}
            aria-pressed={isDone}
            disabled={isPending}
            variant="outline"
            size="icon-sm"
            onPress={tick}
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
            {hasAmount ? (
              <AmountStepper
                habitName={habit.name}
                amount={amount}
                disabled={isPending}
                onAmountChange={changeAmount}
                onRefuse={setRefusal}
              />
            ) : null}
            {/* A second way of keeping the day, not a third state: it opens a
                note, and the tick beside the name is still what undoes it. */}
            <Button
              aria-label={
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
            <Button
              aria-label={isSkipped ? `Un-skip ${habit.name} today` : `Skip ${habit.name} today`}
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
      {(error ?? refusal) && isNoting === false ? (
        <Alert variant="destructive" className="mx-3 mb-3 w-auto" description={error ?? refusal ?? undefined} />
      ) : null}

      <SmallerVersionDialog
        open={isNoting}
        onOpenChange={setIsNoting}
        habitName={habit.name}
        note={isSmaller ? (entry?.note ?? null) : null}
        error={error}
        // The day's amount goes with the note, so rewording 5 of 8 is still 5.
        onSubmit={(note) => markSmaller(habit.id, today, note, hasAmount && isDone ? amount : undefined)}
      />
    </Card>
  );
}
