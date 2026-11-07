import { useEffect } from 'react';
import { useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';

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
      // Stays open on a refusal: the alert under the field says why, and the note is still typed.
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
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title="A smaller version"
      description={`Counts as keeping “${habitName}” today. The note is for you to read back.`}
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      // Around the header, the body and the footer, so the submit is inside the form it submits.
      wrapperSlot={(parts, { className }) => (
        <form.AppForm>
          <Form className={className}>{parts}</Form>
        </form.AppForm>
      )}
      contentClassName="gap-4"
      contentSlot={
        <>
          <form.AppField name="note">
            {(field) => (
              <field.InputField label="What did you do?" autoFocus placeholder="One page instead of a chapter." />
            )}
          </form.AppField>
          {error ? <Alert variant="destructive" description={error} /> : null}
        </>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onPress={close} content="Cancel" />
          <form.SubmitButton createLabel="Keep the day" />
        </>
      )}
    />
  );
}
