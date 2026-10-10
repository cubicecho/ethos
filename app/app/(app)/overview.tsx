import { useQuery } from '@apollo/client';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { BackToTodayLink } from '@/components/domain/habit/back-to-today-link';
import { HabitOverview } from '@/components/domain/habit/habit-overview';
import { useMarkHabitOverview } from '@/components/domain/habit/use-mark-habit';
import { LoadState } from '@/components/domain/query/load-state';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { Alert } from '@/components/ui/alert';
import { Calendar, ChevronLeft, ChevronRight } from '@/components/ui/icons';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { asPeriod } from '@/lib/cadence';
import { HabitsOverviewDocument } from '@/lib/graphql';
import { addDays, formatDay, Period, periodBefore, periodLabel } from '@/lib/periods';
import { useToday } from '@/lib/use-today';

/** What stepping back or forward moves by, in words. */
const SPAN_NAME = {
  [Period.Day]: 'day',
  [Period.Week]: 'week',
  [Period.Month]: 'month',
} satisfies Record<Period, string>;

/** Every habit side by side, over one week or one month. */
export default function OverviewScreen() {
  const today = useToday();
  const [span, setSpan] = useState<Period>(Period.Week);
  // Counted back from today rather than held as a date, so a tab left open
  // over midnight is still showing "this week" in the morning.
  const [spansBack, setSpansBack] = useState(0);
  const range = periodBefore(span, today, spansBack);
  const variables = { today, from: range.start, to: range.end };

  // A day marked on another screen returns no overview rows, so the cache
  // alone would draw this span as it was when it was last opened.
  const habitsQuery = useQuery(HabitsOverviewDocument, { variables, fetchPolicy: 'cache-and-network' });
  const { setDay, isPending, error: markError } = useMarkHabitOverview(variables);

  // The last span's rows stay up while the next one loads: the habits are the
  // same, and a square is looked up by its day, so none is drawn wrongly.
  const data = habitsQuery.data ?? habitsQuery.previousData;
  const habits = data?.habits ?? [];
  const isThisSpan = spansBack === 0;

  return (
    <PageLayout
      width="page"
      title="Overview"
      description={`${formatDay(range.start)} – ${formatDay(addDays(range.end, -1))}`}
      headerContentSlot={
        <View className="flex-row flex-wrap items-center gap-3">
          <SegmentedGroup
            aria-label="Span"
            value={span}
            onValueChange={(value) => {
              setSpan(asPeriod(value));
              setSpansBack(0);
            }}
          >
            <SegmentedButton value={Period.Week}>Week</SegmentedButton>
            <SegmentedButton value={Period.Month}>Month</SegmentedButton>
          </SegmentedGroup>
          <View className="flex-row items-center gap-1">
            <ActionButton
              label={`Previous ${SPAN_NAME[span]}`}
              variant="outline"
              size="icon-sm"
              onPress={() => setSpansBack(spansBack + 1)}
              iconSlot={<ChevronLeft />}
            />
            <ActionButton
              label={`Next ${SPAN_NAME[span]}`}
              variant="outline"
              size="icon-sm"
              disabled={isThisSpan}
              onPress={() => setSpansBack(spansBack - 1)}
              iconSlot={<ChevronRight />}
            />
            <Text className="pl-2 text-foreground/60 text-sm">{periodLabel(span, range.start, today)}</Text>
          </View>
        </View>
      }
      contentClassName="gap-3 py-6"
      contentSlot={
        <>
          <LoadState
            query={{ ...habitsQuery, data }}
            what="your habits"
            count={habits.length}
            emptySlot={
              <EmptyState
                icon={Calendar}
                title="Nothing to look over yet"
                description="Every habit you keep gets a row here, and every day a square."
                actionSlot={<BackToTodayLink />}
              />
            }
          />
          {habits.length > 0 ? (
            <HabitOverview habits={habits} range={range} today={today} disabled={isPending} onValueChange={setDay} />
          ) : null}
          {markError ? <Alert variant="destructive" description={markError} /> : null}
        </>
      }
    />
  );
}
