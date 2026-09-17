import { Link } from 'expo-router';
import { cn } from '@/lib/utils';

export function HabitListItem({
  id,
  name,
  color,
  streak,
  active,
}: {
  id: string;
  name: string;
  color: string;
  /** The current streak, when the list is one where a streak means something. */
  streak?: number;
  active: boolean;
}) {
  return (
    <Link
      href={`/habits/${id}`}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors',
        active ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-accent/60',
      )}
    >
      {/* The habit's colour is how it is recognised on every other screen, so the
          rail carries it too — a dot rather than a filled row, which would make
          the sidebar a colour chart. */}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="truncate">{name}</span>
      {streak !== undefined && streak > 0 ? (
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground text-xs">{streak}</span>
      ) : null}
    </Link>
  );
}
