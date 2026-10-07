import { Text, View } from 'react-native';
import { Check } from '@/components/ui/icons';
import { TooltipProvider } from '@/components/ui/tooltip';
import { asPeriod } from '@/lib/cadence';
import { HISTORY_PERIODS } from '@/lib/graphql';
import { daysOf, Period, periodLabel, recentPeriods, weekdayInitial } from '@/lib/periods';
import { cn } from '@/lib/utils';
import { DaySquare } from './day-square';
import { asStatus, type DayStatus, type HabitEntrySummary, type HabitPeriodSummary, type HabitSummary } from './types';

/** How many weeks of squares a daily habit shows. Four rows of seven reads as a month. */
const DAILY_WEEKS = 4;

interface GridRow {
  key: string;
  label: string;
  days: string[];
  /** The period's tally, or nothing when the row is only a row — see below. */
  tally: HabitPeriodSummary | null;
}

/**
 * The rows the grid draws, which are the habit's own periods — with one
 * exception.
 *
 * A daily habit's period is a single day, so a row per period would be a column
 * of twelve single squares. Those rows are weeks instead: the squares still mean
 * exactly what they mean everywhere else — one day, kept or not — and the week
 * is only how they are laid out, which is why such a row carries no tally. For
 * weekly and monthly habits the row *is* the period, and the tally beside it is
 * the server's, not a re-count of the squares.
 */
function buildRows(period: Period, history: readonly HabitPeriodSummary[], today: string): GridRow[] {
  if (period === Period.Day) {
    return recentPeriods(Period.Week, today, DAILY_WEEKS).map((week) => ({
      key: week.start,
      label: periodLabel(Period.Week, week.start, today),
      days: daysOf(week),
      tally: null,
    }));
  }

  return history.slice(-HISTORY_PERIODS).map((tally) => ({
    key: tally.start,
    label: periodLabel(period, tally.start, today),
    days: daysOf({ start: tally.start, end: tally.end }),
    tally,
  }));
}

export function HabitGrid({
  habit,
  history,
  entries,
  today,
  isPending,
  onSet,
}: {
  habit: HabitSummary;
  history: readonly HabitPeriodSummary[];
  entries: readonly HabitEntrySummary[];
  today: string;
  isPending: boolean;
  onSet: (day: string, status: DayStatus) => void;
}) {
  const period = asPeriod(habit.period);
  const rows = buildRows(period, history, today);
  const status = new Map<string, DayStatus>(entries.map((entry) => [entry.day, asStatus(entry.status)]));
  // Weeks all start on Monday, so the columns are worth naming once at the top.
  // A month's rows start on whatever weekday the first falls on.
  const weekdays = period === Period.Month ? null : rows[0]?.days;

  return (
    // One provider for every square: a tooltip opened right after another one
    // closes skips its delay, which is what makes sweeping along a row readable.
    <TooltipProvider>
      <View className="gap-1">
        {weekdays ? (
          <View className="flex-row items-center gap-1 pl-20" aria-hidden>
            {/* Keyed by the day rather than the initial: two of the seven repeat
                (T, T and S, S), and the day underneath each column does not. */}
            {weekdays.map((day) => (
              <Text key={day} className="w-5 text-center text-[10px] text-foreground/60">
                {weekdayInitial(day)}
              </Text>
            ))}
          </View>
        ) : null}

        {rows.map((row) => (
          <View key={row.key} className="flex-row items-center gap-1">
            <Text className="w-20 shrink-0 truncate pr-2 text-right text-foreground/60 text-xs">{row.label}</Text>
            <View className="shrink flex-row flex-wrap items-center gap-1">
              {row.days.map((day) => (
                <DaySquare
                  key={day}
                  day={day}
                  status={status.get(day) ?? null}
                  color={habit.color}
                  isToday={day === today}
                  isFuture={day > today}
                  disabled={isPending}
                  onSet={onSet}
                />
              ))}
            </View>
            {row.tally ? (
              <View className="ml-2 shrink-0 flex-row items-center gap-1">
                <Text className={cn('text-xs tabular-nums', row.tally.met ? 'text-foreground' : 'text-foreground/60')}>
                  {row.tally.done}/{row.tally.effectiveTarget}
                </Text>
                {/* Follows `met` rather than comparing the two numbers: a period
                    skipped down to nothing owed is kept as well. */}
                {row.tally.met ? <Check className="h-3 w-3 text-foreground" /> : null}
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </TooltipProvider>
  );
}
