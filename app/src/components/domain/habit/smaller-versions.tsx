import { Text, View } from 'react-native';
import { describeAmount } from '@/lib/cadence';
import { joinStats } from '@/lib/format';
import { formatDayLong } from '@/lib/periods';
import type { HabitEntrySummary } from './types';

/** The days a habit was kept as a smaller version, newest first, with how much and what was done instead. */
export function SmallerVersions({
  entries,
}: {
  /** The habit's entries, newest first. Only the smaller versions among them are drawn. */
  entries: readonly HabitEntrySummary[];
}) {
  return (
    <View role="list" className="gap-3">
      {entries
        .filter((entry) => entry.partial)
        .map((entry) => (
          <View key={entry.id} role="listitem" className="gap-0.5">
            {/* The amount beside the day, so a smaller version with no note still says how much. */}
            <Text className="text-foreground/60 text-xs">
              {joinStats(
                formatDayLong(entry.day),
                entry.dailyAmount > 1 && describeAmount(entry.amount, entry.dailyAmount),
              )}
            </Text>
            <Text className={entry.note ? 'text-foreground text-sm' : 'text-foreground/60 text-sm'}>
              {entry.note ?? 'No note.'}
            </Text>
          </View>
        ))}
    </View>
  );
}
