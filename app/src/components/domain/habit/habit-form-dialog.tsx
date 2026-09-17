import { useMutation } from '@apollo/client';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type Segment, SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { placeHabit } from '@/lib/cache';
import { describeCadence, maxTargetFor } from '@/lib/cadence';
import { describeError } from '@/lib/errors';
import { CreateHabitDocument, UpdateHabitDocument } from '@/lib/graphql';
import { newId } from '@/lib/ids';
import { type Period, periodOf } from '@/lib/periods';
import type { HabitSummary } from './types';

/** A small fixed palette — picking a colour should be one click, not a colour wheel. */
const PALETTE = ['#0f766e', '#0369a1', '#4f46e5', '#7c3aed', '#be185d', '#b91c1c', '#c2410c', '#4d7c0f'];

const CADENCES: readonly Segment<Period>[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

export function HabitFormDialog({
  open,
  onOpenChange,
  today,
  habit,
  nextPosition = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  habit?: HabitSummary;
  /** Where a new habit goes in the list. Ignored when editing. */
  nextPosition?: number;
}) {
  const cadenceTabs = useId();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [period, setPeriod] = useState<Period>('day');
  const [targetCount, setTargetCount] = useState(1);
  const [createHabit, { loading: creating, error: createError }] = useMutation(CreateHabitDocument);
  const [updateHabit, { loading: updating, error: updateError }] = useMutation(UpdateHabitDocument);

  useEffect(() => {
    if (!open) return;
    setName(habit?.name ?? '');
    setNotes(habit?.notes ?? '');
    setColor(habit?.color ?? PALETTE[0]);
    setPeriod((habit?.period as Period) ?? 'day');
    setTargetCount(habit?.targetCount ?? 1);
  }, [open, habit]);

  // A day cannot be kept twice, so the daily cadence has no number to pick and
  // the field is not shown. Forcing the value here rather than at submit keeps
  // the form honest about what it is going to send.
  function changePeriod(next: Period) {
    setPeriod(next);
    if (next === 'day') setTargetCount(1);
    else setTargetCount((current) => Math.min(Math.max(current, 1), maxTargetFor(next)));
  }

  const max = maxTargetFor(period);
  const valid = name.trim() !== '' && targetCount >= 1 && targetCount <= max;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const values = {
      name: name.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      color,
      period,
      targetCount,
    };

    try {
      if (habit) {
        await updateHabit({ variables: { id: habit.id, set: values, today } });
      } else {
        const id = newId();
        const range = periodOf(period, today);
        await createHabit({
          variables: { values: { id, ...values, position: nextPosition }, today },
          // Every derived field is known for a habit with no days yet: no
          // streak, nothing kept, nothing skipped. Stating them is what lets the
          // row appear complete rather than flickering through a half-drawn one.
          optimisticResponse: {
            createHabit: {
              __typename: 'Habit',
              id,
              ...values,
              position: nextPosition,
              archivedAt: null,
              streak: 0,
              longestStreak: 0,
              current: {
                __typename: 'HabitPeriod',
                start: range.start,
                end: range.end,
                done: 0,
                skipped: 0,
                target: targetCount,
                effectiveTarget: targetCount,
                met: false,
                rate: 0,
              },
              todayEntry: [],
            },
          },
          update(cache, { data }) {
            if (data?.createHabit) placeHabit(cache, today, data.createHabit);
          },
        });
      }
    } catch {
      // The mutation rejects as well as setting `error`, so an uncaught await
      // here is both an unhandled rejection and a dialog that stays open with
      // no explanation of why. Stay open — deliberately — but say so: what was
      // typed is still in the fields, ready to send again.
      return;
    }
    onOpenChange(false);
  }

  const error = createError ?? updateError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{habit ? 'Edit habit' : 'New habit'}</DialogTitle>
          <DialogDescription>A habit is a thing you mean to do, and how often. Nothing more.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="habit-name">Name</Label>
            <Input
              id="habit-name"
              autoFocus
              value={name}
              placeholder="Run"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cadence</Label>
            <SegmentedControl
              value={period}
              segments={CADENCES}
              label="Cadence"
              idPrefix={cadenceTabs}
              onChange={changePeriod}
            />
          </div>

          {period === 'day' ? null : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="habit-target">Times per {period}</Label>
              <Input
                id="habit-target"
                type="number"
                min={1}
                max={max}
                value={String(targetCount)}
                onChange={(event) => setTargetCount(Number.parseInt(event.target.value, 10) || 0)}
              />
              <p className="text-muted-foreground text-xs">
                {targetCount > max
                  ? `A ${period} has at most ${max} days to keep it on.`
                  : describeCadence(period, targetCount)}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="habit-notes">Notes</Label>
            <Textarea
              id="habit-notes"
              value={notes}
              placeholder="Optional."
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch}
                  aria-pressed={swatch === color}
                  onClick={() => setColor(swatch)}
                  className={
                    swatch === color
                      ? 'h-7 w-7 rounded-full ring-2 ring-ring ring-offset-2 ring-offset-background'
                      : 'h-7 w-7 rounded-full'
                  }
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{describeError(error)}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || updating || !valid}>
              {habit ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
