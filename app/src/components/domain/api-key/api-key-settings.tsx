import { useMutation, useQuery } from '@apollo/client';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DialogLayout } from '@/components/dialog-layout';
import { LoadState } from '@/components/domain/query/load-state';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Form } from '@/components/ui/form';
import { KeyRound, Plus, Trash2 } from '@/components/ui/icons';
import { describeError } from '@/lib/errors';
import { formatDate, joinStats } from '@/lib/format';
import { ApiKeysDocument, CreateApiKeyDocument, DeleteApiKeyDocument } from '@/lib/graphql';

// API keys: how another program — auto-cal, a dashboard — reads and records
// habits as you. Minting refetches the list, since the server mints the id and
// the key alike; a revoke drops the key from the cache once the server has.

/** better-auth takes a lifetime in seconds; the choices are in days. */
const SECONDS_PER_DAY = 24 * 60 * 60;

/** What a key with no lifetime is: one that never expires. */
const NEVER = 'never';

const EXPIRY_OPTIONS = [
  { label: 'Never', value: NEVER },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: 'A year', value: '365' },
] as const;

/** The most better-auth takes for a key's name. */
const MAX_NAME_LENGTH = 32;

/** A key as the list holds it. */
type KeyRow = {
  id: string;
  name?: string | null;
  start?: string | null;
  createdAt: string;
  lastRequest?: string | null;
  expiresAt?: string | null;
};

/**
 * What a key's row says under its name: when it was made, used, and when it stops.
 *
 * @param key - The key.
 * @returns One line of facts.
 */
function describeKey(key: KeyRow): string {
  return joinStats(
    key.start ? `${key.start}…` : null,
    `created ${formatDate(key.createdAt)}`,
    key.lastRequest ? `last used ${formatDate(key.lastRequest)}` : 'never used',
    key.expiresAt ? `expires ${formatDate(key.expiresAt)}` : null,
  );
}

/** Settings' API keys card: the caller's keys, a New key button, and a revoke on every row. */
export function ApiKeySettings() {
  const keysQuery = useQuery(ApiKeysDocument);
  const [deleteKey] = useMutation(DeleteApiKeyDocument);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const keys = keysQuery.data?.apiKeys ?? [];

  async function revoke(id: string) {
    setRevokeError(null);
    setRevoking(id);
    try {
      await deleteKey({
        variables: { keyId: id },
        update(cache) {
          // The list holds the key by reference, and a dangling one is dropped when the list is read.
          cache.evict({ id: cache.identify({ __typename: 'ApiKey', id }) });
          cache.gc();
        },
      });
    } catch (cause) {
      setRevokeError(describeError(cause));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <CardLayout
      level={2}
      title="API keys"
      description="For another program, such as a calendar or a dashboard, to read and record your habits. A key acts as you until it is revoked."
      actionSlot={
        <Button variant="info" size="sm" iconSlot={<Plus />} content="New key" onPress={() => setCreating(true)} />
      }
      contentSlot={
        <View className="gap-4">
          {revokeError ? <Alert variant="destructive" title="Could not revoke" description={revokeError} /> : null}
          <LoadState
            query={keysQuery}
            what="your API keys"
            count={keys.length}
            compact
            emptySlot={<EmptyState compact iconSlot={<KeyRound />} title="No keys yet." />}
          />
          <List
            label="API keys"
            contentSlot={keys.map((key) => (
              <ListItem
                key={key.id}
                title={key.name || 'Unnamed key'}
                description={describeKey(key)}
                actionSlot={
                  <ConfirmButton
                    size="icon-sm"
                    aria-label={`Revoke ${key.name || 'key'}`}
                    loading={revoking === key.id}
                    title={`Revoke “${key.name || 'this key'}”?`}
                    description="Whatever calls Ethos with it is turned away from its next request on."
                    confirmLabel="Revoke"
                    onConfirm={() => void revoke(key.id)}
                    iconSlot={<Trash2 />}
                  />
                }
              />
            ))}
          />
          <CreateApiKeyDialog open={creating} onOpenChange={setCreating} />
        </View>
      }
    />
  );
}

type CreateApiKeyDialogProps = {
  /** Whether the dialog is showing. Opening it starts over at an empty form. */
  open: boolean;
  /** Called with false when it closes, from Cancel, Done or the dialog's own close. */
  onOpenChange: (open: boolean) => void;
};

/**
 * Names a key and mints it, then shows it once. Only its hash is stored, so the
 * dialog's second state is the only place the key is ever readable.
 */
function CreateApiKeyDialog({ open, onOpenChange }: CreateApiKeyDialogProps) {
  const [createKey, { error }] = useMutation(CreateApiKeyDocument, {
    refetchQueries: [ApiKeysDocument],
    awaitRefetchQueries: true,
  });
  const [minted, setMinted] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: { name: '', expiry: NEVER as string },
    onSubmit: ({ value }) => mint(value),
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setMinted(null);
    form.reset({ name: '', expiry: NEVER });
  }, [open, form]);

  async function mint({ name, expiry }: { name: string; expiry: string }) {
    try {
      const result = await createKey({
        variables: { name: name.trim(), expiresIn: expiry === NEVER ? null : Number(expiry) * SECONDS_PER_DAY },
      });
      setMinted(result.data?.createApiKey.key ?? null);
    } catch {
      // The mutation rejects as well as setting `error`, which the alert shows; what was typed stays.
    }
  }

  if (minted) {
    return (
      <DialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title="Your new key"
        description="Copy it now. Only a hash of it is kept, so it cannot be shown again."
        contentClassName="gap-4"
        contentSlot={
          <>
            <CodeBlock content={minted} wrap actionSlot={<CopyButton value={minted} label="Copy the key" />} />
            <Alert
              variant="info"
              description="Send it as the x-api-key header, to /graphql or /mcp. It acts as you until it is revoked here."
            />
          </>
        }
        footerActionsSlot={<Button onPress={() => onOpenChange(false)} content="Done" />}
      />
    );
  }

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title="New API key"
      description="Name it after the program that will hold it, so you know which one to revoke."
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
          <form.AppField
            name="name"
            validators={{
              onChange: ({ value }) => {
                if (value.trim() === '') {
                  return 'A key needs a name.';
                }
                return value.trim().length > MAX_NAME_LENGTH ? `Keep it to ${MAX_NAME_LENGTH} characters.` : undefined;
              },
            }}
          >
            {(field) => <field.InputField label="Name" autoFocus placeholder="auto-cal" />}
          </form.AppField>
          <form.AppField name="expiry">
            {(field) => <field.SelectField label="Expires" options={EXPIRY_OPTIONS} />}
          </form.AppField>
          {error ? <Alert variant="destructive" description={describeError(error)} /> : null}
        </>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onPress={close} content="Cancel" />
          <form.SubmitButton createLabel="Create key" />
        </>
      )}
    />
  );
}
