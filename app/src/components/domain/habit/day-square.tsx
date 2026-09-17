import { formatDayLong } from '@/lib/periods';
import { readableTextColor } from '@/lib/readable-text-color';
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
 */
export function DaySquare({
  day,
  status,
  color,
  today,
  future,
  disabled,
  onSet,
}: {
  day: string;
  status: DayStatus;
  color: string;
  today: boolean;
  /** A day that has not happened yet: drawn, so the period keeps its shape, but not clickable. */
  future: boolean;
  disabled?: boolean;
  /** Called with what the day should become — the cycle is this component's. */
  onSet: (day: string, status: DayStatus) => void;
}) {
  const state = future ? 'to come' : status === 'done' ? 'kept' : status === 'skipped' ? 'skipped' : 'not kept';
  const label = `${formatDayLong(day)} — ${state}`;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={status !== null}
      disabled={future || disabled}
      onClick={() => onSet(day, nextStatus(status))}
      className={cn(
        'h-5 w-5 shrink-0 rounded-[3px] border transition-colors',
        future
          ? 'cursor-default border-dashed border-border/50 bg-transparent'
          : 'hover:border-ring disabled:opacity-60',
        status === 'skipped' && 'border-2 border-dashed border-muted-foreground/70 bg-transparent',
        status === null && !future && 'border-border bg-muted/50',
        // Today is outlined rather than filled: the outline survives whatever
        // the square's own state is, so "today" and "kept" are readable at once.
        today && 'outline outline-2 outline-ring outline-offset-1',
      )}
      style={
        status === 'done' ? { backgroundColor: color, borderColor: color, color: readableTextColor(color) } : undefined
      }
    />
  );
}
