import { useEffect } from 'react';
import { useAppForm } from '@/components/app-form';
import { Form } from '@/components/ui/form';
import { FormDialog, FormDialogFooter } from '@/components/ui/form-dialog';

/** Asks what was done instead, for a day kept as a smaller version of the habit. */
export function SmallerVersionDialog({
  open,
  onOpenChange,
  habitName,
  note,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habitName: string;
  /** What the day already says, when it is being reworded. */
  note: string | null;
  /** Why the last attempt was refused, as a sentence. */
  error: string | null;
  /** Called with the note, or `null` for none. Resolves to whether the day was recorded. */
  onSubmit: (note: string | null) => Promise<boolean>;
}) {
  const form = useAppForm({
    defaultValues: { note: note ?? '' },
    onSubmit: async ({ value }) => {
      const text = value.note.trim();
      // Stays open on a refusal: the footer says why, and the note is still typed.
      if (await onSubmit(text === '' ? null : text)) {
        onOpenChange(false);
      }
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ note: note ?? '' });
    }
  }, [open, note, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="A smaller version"
      description={`Counts as keeping “${habitName}” today. The note is for you to read back.`}
    >
      <form.AppForm>
        <Form className="gap-4">
          <form.AppField name="note">
            {(field) => (
              <field.InputField label="What did you do?" autoFocus placeholder="One page instead of a chapter." />
            )}
          </form.AppField>
          <FormDialogFooter onCancel={() => onOpenChange(false)} error={error}>
            <form.SubmitButton createLabel="Keep the day" />
          </FormDialogFooter>
        </Form>
      </form.AppForm>
    </FormDialog>
  );
}
