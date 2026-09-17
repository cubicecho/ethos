import { useMutation } from '@apollo/client';
import { useRouter } from 'expo-router';
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { placeHabit, removeHabit } from '@/lib/cache';
import { describeCadence } from '@/lib/cadence';
import { describeError } from '@/lib/errors';
import { DeleteHabitDocument, UpdateHabitDocument } from '@/lib/graphql';
import type { Period } from '@/lib/periods';
import { HabitFormDialog } from './habit-form-dialog';
import type { HabitSummary } from './types';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="font-medium tabular-nums text-lg" title={hint}>
        {value}
      </dd>
    </div>
  );
}

export function HabitOverview({ habit, today }: { habit: HabitSummary; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updateHabit] = useMutation(UpdateHabitDocument);
  const [deleteHabit] = useMutation(DeleteHabitDocument);

  const period = habit.period as Period;
  const archived = habit.archivedAt != null;

  /**
   * Archiving is the ordinary way to stop a habit, and it is a plain column
   * update — so it is the generated mutation, not one written for the occasion.
   * The days stay, which is the whole point: a habit put down after a year is a
   * year of days worth keeping, and the archive is where it is un-put-down from.
   */
  async function setArchived(next: boolean) {
    setActionError(null);
    try {
      await updateHabit({
        variables: { id: habit.id, set: { archivedAt: next ? new Date().toISOString() : null }, today },
        update(cache, { data }) {
          if (data?.updateHabit) placeHabit(cache, today, data.updateHabit);
        },
      });
    } catch (cause) {
      setActionError(describeError(cause));
    }
  }

  return (
    <header className="flex flex-col gap-3 border-b pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1.5 h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: habit.color }} aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-2xl tracking-tight">{habit.name}</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {describeCadence(period, habit.targetCount)}
              {archived ? ' · Archived' : ''}
            </p>
            {habit.notes ? <p className="mt-2 text-sm">{habit.notes}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label="Edit habit">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setArchived(!archived)}
            aria-label={archived ? 'Restore habit' : 'Archive habit'}
          >
            {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete habit"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <dl className="flex gap-6 text-sm">
        <Stat label="Streak" value={`${habit.streak}`} hint={`${habit.streak} ${period}s in a row`} />
        <Stat label="Best" value={`${habit.longestStreak}`} />
        <Stat
          label={period === 'day' ? 'Today' : `This ${period}`}
          value={`${habit.current.done}/${habit.current.effectiveTarget}`}
          hint={
            habit.current.skipped > 0 ? `${habit.current.skipped} skipped, and skips come off the target` : undefined
          }
        />
      </dl>

      {actionError ? (
        <p className="text-destructive text-sm" aria-live="polite">
          {actionError}
        </p>
      ) : null}

      <HabitFormDialog open={editing} onOpenChange={setEditing} today={today} habit={habit} />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{habit.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Every day recorded against it goes too. Archiving keeps them, and puts the habit away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setActionError(null);
                try {
                  await deleteHabit({
                    variables: { id: habit.id },
                    update: (cache) => removeHabit(cache, today, habit.id),
                  });
                } catch (cause) {
                  // Stay put. Navigating away from a habit that is still there
                  // would look like the delete worked.
                  setActionError(describeError(cause));
                  setConfirmingDelete(false);
                  return;
                }
                router.replace('/');
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
