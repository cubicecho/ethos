import { Link } from 'expo-router';
import { Check, Flame, SkipForward } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
 * the same button that did it.
 */
export function HabitRow({ habit, today }: { habit: HabitSummary; today: string }) {
  const { setDay, pending, error } = useMarkHabit(today);
  const status = asStatus(habit.todayEntry[0]?.status);
  const period = habit.period as Period;
  const ink = readableTextColor(habit.color);

  const toggle = (next: 'done' | 'skipped') => setDay(habit.id, today, status === next ? null : next);

  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={status === 'done' ? `Undo ${habit.name} for today` : `Mark ${habit.name} kept today`}
          aria-pressed={status === 'done'}
          disabled={pending}
          onClick={() => toggle('done')}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-60',
            status === 'done' ? 'border-transparent' : 'border-border text-transparent hover:border-ring',
          )}
          style={status === 'done' ? { backgroundColor: habit.color, color: ink } : undefined}
        >
          <Check className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <Link
            href={`/habits/${habit.id}`}
            className="truncate font-medium text-foreground text-sm no-underline hover:underline"
          >
            {habit.name}
          </Link>
          <p className="truncate text-muted-foreground text-xs">
            {describeCadence(period, habit.targetCount)}
            {' · '}
            {status === 'skipped'
              ? 'Skipped today'
              : describeProgress(habit.current.done, habit.current.effectiveTarget, period)}
          </p>
        </div>

        {habit.streak > 0 ? (
          <Badge variant="secondary" title={`${habit.streak} ${period}s in a row`}>
            <Flame className="h-3 w-3" />
            {habit.streak}
          </Badge>
        ) : null}

        <button
          type="button"
          aria-label={status === 'skipped' ? `Un-skip ${habit.name} today` : `Skip ${habit.name} today`}
          aria-pressed={status === 'skipped'}
          disabled={pending}
          onClick={() => toggle('skipped')}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60',
            status === 'skipped' && 'bg-accent text-accent-foreground',
          )}
        >
          <SkipForward className="h-4 w-4" />
        </button>
      </div>

      {/* Beside the control that caused it. A skip refused because the period
          has had its two is worth reading, and a toast in a corner is not where
          the click was. */}
      {error ? (
        <p className="pl-12 text-destructive text-xs" aria-live="polite">
          {error}
        </p>
      ) : null}
    </li>
  );
}
