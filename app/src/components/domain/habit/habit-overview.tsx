import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { ColorDot } from '@/components/ui/color-dot';
import { Check } from '@/components/ui/icons';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatCount } from '@/lib/format';
import { habitPath } from '@/lib/habits';
import { daysOf, type PeriodRange, weekdayInitial } from '@/lib/periods';
import { cn } from '@/lib/utils';
import { DaySquare } from './day-square';
import { asStatus, type DayStatus, ENTRY_DONE, type HabitOverviewSummary, smallerDays } from './types';

/** How much of a `YYYY-MM-DD` names the date within its month. */
const DATE_LENGTH = 'DD'.length;

/**
 * The date within its month, as a column heading writes it.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @returns The date, without its leading zero.
 */
function dateOfMonth(day: string): string {
  return String(Number(day.slice(-DATE_LENGTH)));
}

/**
 * Whether the span on screen is the period the habit is counted over right now.
 *
 * @param habit - The habit.
 * @param range - The span being drawn.
 * @returns True when the server's current tally is a tally of exactly these days.
 */
function isCurrentPeriod(habit: HabitOverviewSummary, range: PeriodRange): boolean {
  return habit.current.start === range.start && habit.current.end === range.end;
}

/**
 * What a row says at its far end.
 *
 * The server's tally when the span is the habit's own current period, and
 * otherwise only how many squares are filled. A "5/7" worked out here for a
 * span the habit is not counted over would be a rate nobody can reproduce.
 */
function RowTally({
  habit,
  range,
  keptCount,
}: {
  habit: HabitOverviewSummary;
  /** The span being drawn. */
  range: PeriodRange;
  /** How many of the span's days are kept. */
  keptCount: number;
}) {
  if (isCurrentPeriod(habit, range) === false) {
    return (
      <Text aria-label={formatCount(keptCount, 'day kept', 'days kept')} className="text-foreground/60 text-xs">
        {keptCount}
      </Text>
    );
  }

  const { done, effectiveTarget, met } = habit.current;
  return (
    <>
      <Text className={cn('text-xs tabular-nums', met ? 'text-foreground' : 'text-foreground/60')}>
        {done}/{effectiveTarget}
      </Text>
      {met ? <Check className="h-3 w-3 text-foreground" /> : null}
    </>
  );
}

/** Every habit against the days of one week or month: a row each, a square a day. */
export function HabitOverview({
  habits,
  range,
  today,
  disabled,
  onValueChange,
}: {
  /** The habits, each with the days it has marked inside `range`. */
  habits: readonly HabitOverviewSummary[];
  /** The span being drawn: one week or one month. */
  range: PeriodRange;
  /** The caller's day. Days after it are drawn but cannot be pressed. */
  today: string;
  /** Whether the squares refuse a press: a mark is on its way to the server. */
  disabled: boolean;
  /** Called with a habit, a day and what the day should become. */
  onValueChange: (habitId: string, day: string, value: DayStatus) => void;
}) {
  const days = daysOf(range);

  return (
    // One provider for every square, as in `HabitGrid`: sweeping along a row
    // skips the tooltip's delay.
    <TooltipProvider>
      {/* A month is wider than a phone, so the rows scroll sideways together. */}
      <ScrollView horizontal contentContainerClassName="flex-col gap-1 pb-2">
        <View className="flex-row items-end gap-1 pl-40" aria-hidden>
          {days.map((day) => (
            <View key={day} className="w-5 items-center">
              <Text className="text-[10px] text-foreground/60">{weekdayInitial(day)}</Text>
              <Text
                className={cn(
                  'text-[10px] tabular-nums',
                  day === today ? 'font-semibold text-foreground' : 'text-foreground/60',
                )}
              >
                {dateOfMonth(day)}
              </Text>
            </View>
          ))}
        </View>

        <View role="list" className="gap-1">
          {habits.map((habit) => {
            const status = new Map<string, DayStatus>(
              habit.rangeEntries.map((entry) => [entry.day, asStatus(entry.status)]),
            );
            const smaller = smallerDays(habit.rangeEntries);
            const keptCount = days.filter((day) => status.get(day) === ENTRY_DONE).length;

            return (
              // Named for the habit: a square's own label says its day and its
              // state, and in this grid that is true of every row at once.
              <View key={habit.id} role="listitem" aria-label={habit.name} className="flex-row items-center gap-1">
                <View className="w-40 shrink-0 flex-row items-center gap-2 pr-2">
                  <ColorDot color={habit.color} size="sm" />
                  <Link href={habitPath(habit.id)} className="shrink truncate text-foreground text-sm no-underline">
                    {habit.name}
                  </Link>
                </View>
                {days.map((day) => (
                  <DaySquare
                    key={day}
                    day={day}
                    value={status.get(day) ?? null}
                    color={habit.color}
                    isToday={day === today}
                    isFuture={day > today}
                    isSmaller={smaller.has(day)}
                    disabled={disabled}
                    onValueChange={(value) => onValueChange(habit.id, day, value)}
                  />
                ))}
                <View className="ml-2 shrink-0 flex-row items-center gap-1">
                  <RowTally habit={habit} range={range} keptCount={keptCount} />
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </TooltipProvider>
  );
}
