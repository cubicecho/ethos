import { Pressable } from 'react-native';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDayLong } from '@/lib/periods';
import { cn } from '@/lib/utils';
import { type DayStatus, nextStatus } from './types';

/**
 * One day of one habit.
 *
 * The three states are told apart by shape as well as by colour — filled, dashed
 * outline, plain outline — because the fill is the habit's own colour and a
 * reader who cannot tell two of them apart would have no way back. Every square
 * also carries the day and its state in its label, which is what a screen reader
 * reads and what the pointer shows on hover.
 *
 * A `Pressable` of its own rather than cubeui's `Button`: a square is 20px and
 * wears the habit's colour, and neither is a size or a variant a button has. The
 * tooltip is cubeui's, under the one provider `HabitGrid` draws.
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
  const state = isFuture ? 'to come' : status === 'done' ? 'kept' : status === 'skipped' ? 'skipped' : 'not kept';
  const label = `${formatDayLong(day)} — ${state}`;

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
            isFuture ? 'cursor-default border-border/50 border-dashed bg-transparent' : 'hover:border-ring',
            !isFuture && disabled && 'opacity-60',
            status === 'skipped' && 'border-2 border-foreground/60 border-dashed bg-transparent',
            status === null && !isFuture && 'border-border bg-muted/50',
            // Today is outlined rather than filled: the outline survives whatever
            // the square's own state is, so "today" and "kept" are readable at once.
            isToday && 'outline-2 outline-ring outline-offset-1',
          )}
          style={status === 'done' ? { backgroundColor: color, borderColor: color } : undefined}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
