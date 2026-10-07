import { useMutation } from '@apollo/client';
import { useEffect } from 'react';
import { useAppForm } from '@/components/app-form';
import { RadioGroupField, type RadioOption } from '@/components/radio-group-field';
import { isHexColor } from '@/components/ui/color-picker';
import { Form } from '@/components/ui/form';
import { FormDialog, FormDialogFooter } from '@/components/ui/form-dialog';
import { placeHabit } from '@/lib/cache';
import { describeCadence, maxTargetFor } from '@/lib/cadence';
import { describeError } from '@/lib/errors';
import { CreateHabitDocument, UpdateHabitDocument } from '@/lib/graphql';
import { newId } from '@/lib/ids';
import { PALETTE } from '@/lib/palette';
import { type Period, periodOf } from '@/lib/periods';
import type { HabitSummary } from './types';

const CADENCES: readonly RadioOption[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

type HabitValues = {
  name: string;
  notes: string;
  color: string;
  period: Period;
  /** `null` while the box is empty: a number field that has been cleared holds no number. */
  targetCount: number | null;
};

const valuesOf = (habit: HabitSummary | undefined): HabitValues => ({
  name: habit?.name ?? '',
  notes: habit?.notes ?? '',
  color: habit?.color ?? PALETTE[0],
  period: (habit?.period as Period) ?? 'day',
  targetCount: habit?.targetCount ?? 1,
});

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
  const [createHabit, { loading: isCreating, error: createError }] = useMutation(CreateHabitDocument);
  const [updateHabit, { loading: isUpdating, error: updateError }] = useMutation(UpdateHabitDocument);

  const form = useAppForm({
    defaultValues: valuesOf(habit),
    onSubmit: ({ value }) => save(value),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(valuesOf(habit));
  }, [open, habit, form]);

  async function save({ name, notes, color, period, targetCount }: HabitValues) {
    if (isCreating || isUpdating) return;
    const values = {
      name: name.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      color,
      period,
      // The field's validator has already refused an empty box.
      targetCount: targetCount ?? 1,
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
                target: values.targetCount,
                effectiveTarget: values.targetCount,
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={habit ? 'Edit habit' : 'New habit'}
      description="A habit is a thing you mean to do, and how often. Nothing more."
    >
      <form.AppForm>
        <Form className="gap-4">
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => (value.trim() === '' ? 'Give the habit a name.' : undefined) }}
          >
            {(field) => <field.InputField label="Name" autoFocus placeholder="Run" />}
          </form.AppField>

          <RadioGroupField
            form={form}
            name="period"
            label="Cadence"
            variant="segmented"
            options={CADENCES}
            listeners={{
              // A day cannot be kept twice, so the daily cadence has no number to
              // pick and the field is not shown. Forcing the value here rather
              // than at submit keeps the form honest about what it will send.
              onChange: ({ value }) => {
                const next = value as Period;
                const current = form.getFieldValue('targetCount') ?? 1;
                form.setFieldValue(
                  'targetCount',
                  next === 'day' ? 1 : Math.min(Math.max(current, 1), maxTargetFor(next)),
                );
              },
            }}
          />

          <form.Subscribe selector={(state) => state.values.period}>
            {(period) =>
              period === 'day' ? null : (
                <form.AppField
                  name="targetCount"
                  validators={{
                    // The same bounds the server enforces, said before the request
                    // rather than after it.
                    onChange: ({ value }) => {
                      const max = maxTargetFor(period);
                      if (value == null || !Number.isInteger(value) || value < 1) return 'Enter a whole number.';
                      return value > max ? `A ${period} has at most ${max} days to keep it on.` : undefined;
                    },
                  }}
                >
                  {(field) => (
                    <field.InputField
                      label={`Times per ${period}`}
                      type="number"
                      description={
                        field.state.value != null && field.state.meta.errors.length === 0
                          ? describeCadence(period, field.state.value)
                          : undefined
                      }
                    />
                  )}
                </form.AppField>
              )
            }
          </form.Subscribe>

          <form.AppField name="notes">
            {(field) => <field.TextAreaField label="Notes" placeholder="Optional." />}
          </form.AppField>

          {/* cubeui's picker also takes a typed hex, so the colour can be half-typed. */}
          <form.AppField
            name="color"
            validators={{
              onChange: ({ value }) => (isHexColor(value) ? undefined : 'Pick a colour, or finish the hex.'),
            }}
          >
            {(field) => <field.ColorField label="Colour" colors={PALETTE} />}
          </form.AppField>

          <FormDialogFooter onCancel={() => onOpenChange(false)} error={error ? describeError(error) : null}>
            <form.SubmitButton isEdit={habit !== undefined} editLabel="Save" />
          </FormDialogFooter>
        </Form>
      </form.AppForm>
    </FormDialog>
  );
}
