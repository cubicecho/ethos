import { Pressable } from 'react-native';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDayLong } from '@/lib/periods';
import { cn } from '@/lib/utils';
import { type DayStatus, ENTRY_DONE, ENTRY_SKIPPED, type EntryStatus, nextStatus } from './types';

const STATE_OF = {
  [ENTRY_DONE]: 'kept',
  [ENTRY_SKIPPED]: 'skipped',
} satisfies Record<EntryStatus, string>;

/** The square's state in words, for the label a screen reader and the tooltip share. */
function describeState(status: DayStatus, isFuture: boolean): string {
  if (isFuture) {
    return 'to come';
  }
  return status === null ? 'not kept' : STATE_OF[status];
}

/**
 * One day of one habit.
 *
 * The three states differ by shape as well as colour — filled, dashed outline,
 * plain outline — because the fill is the habit's own colour and a reader may
 * not tell two of them apart. A `Pressable` of its own rather than cubeui's
 * `Button`: a square is 20px and wears the habit's colour, and a button has
 * neither as a size or a variant.
 */
export function DaySquare({
  day,
  status,
  color,
  isToday,
  isFuture,
  disabled,
  onSet,
}: {
  day: string;
  status: DayStatus;
  color: string;
  isToday: boolean;
  /** A day that has not happened yet: drawn, so the period keeps its shape, but not pressable. */
  isFuture: boolean;
  disabled?: boolean;
  /** Called with what the day should become — the cycle is this component's. */
  onSet: (day: string, status: DayStatus) => void;
}) {
  const label = `${formatDayLong(day)} — ${describeState(status, isFuture)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pressable
          role="button"
          aria-label={label}
          aria-pressed={status !== null}
          disabled={isFuture || disabled}
          onPress={() => onSet(day, nextStatus(status))}
          className={cn(
            'h-5 w-5 shrink-0 rounded-[3px] border transition-colors',
            // Further out than today's outline and in another colour, so focus on today still shows.
            'focus-visible:outline-2 focus-visible:outline-active focus-visible:outline-offset-2',
            isFuture ? 'cursor-default border-border/50 border-dashed bg-transparent' : 'hover:border-ring',
            isFuture === false && disabled && 'opacity-60',
            status === ENTRY_SKIPPED && 'border-2 border-foreground/60 border-dashed bg-transparent',
            status === null && isFuture === false && 'border-border bg-muted/50',
            // Today is outlined rather than filled: the outline survives whatever
            // the square's own state is, so "today" and "kept" are readable at once.
            isToday && 'outline-2 outline-ring outline-offset-1',
          )}
          style={status === ENTRY_DONE ? { backgroundColor: color, borderColor: color } : undefined}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
