import { useMutation, useQuery } from '@apollo/client';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAppForm } from '@/components/app-form';
import { ConfirmButton } from '@/components/confirm-button';
import { LoadFailure } from '@/components/domain/query/load-state';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { Form } from '@/components/ui/form';
import { describeError } from '@/lib/errors';
import { PairSsoDocument, SsoSetupDocument, UnpairSsoDocument } from '@/lib/graphql';

// Pairing the instance with an OIDC provider (heautou, or any that supports Dynamic Client
// Registration) by pasting the setup URL it gives you. The login page's button is `authConfig.sso`,
// so both queries are asked again after a change: neither answer has an id to update in place.

const REFETCH = { refetchQueries: ['SsoSetup', 'AuthConfig'], awaitRefetchQueries: true };

/** What a provider with no name of its own is called. Matches the server's default. */
const UNNAMED = 'SSO';

type PairSsoFormProps = {
  /** Called with the provider's name once it is paired. */
  onPaired?: ((name: string) => void) | undefined;
};

/** The paste-and-connect form. The server decides who may pair; this only asks. */
export function PairSsoForm({ onPaired }: PairSsoFormProps) {
  const [pairSso] = useMutation(PairSsoDocument, REFETCH);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { setupUrl: '' },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        const { data } = await pairSso({ variables: { setupUrl: value.setupUrl.trim() } });
        formApi.reset();
        onPaired?.(data?.pairSso.name ?? UNNAMED);
      } catch (cause) {
        setError(describeError(cause));
      }
    },
  });

  return (
    <form.AppForm>
      <Form className="gap-4">
        {error ? <Alert variant="destructive" title="Could not pair" description={error} /> : null}
        <form.AppField
          name="setupUrl"
          validators={{ onChange: ({ value }) => (value.trim() === '' ? 'Paste the setup URL.' : undefined) }}
        >
          {(field) => (
            <field.InputField
              label="Setup URL"
              type="url"
              placeholder="https://id.example.com/oidc#setup=…"
              description="Your provider's admin makes this for Ethos. It works once, and only for a short while."
            />
          )}
        </form.AppField>
        <form.SubmitButton createLabel="Connect" savingLabel="Connecting…" />
      </Form>
    </form.AppForm>
  );
}

/**
 * Settings' sign-in body: which provider the login page offers, and connecting or disconnecting
 * one. A provider set in the server's environment is shown but cannot be changed here. Settings
 * shows it to the admin only.
 */
export function SsoSettings() {
  const { data, error, refetch } = useQuery(SsoSetupDocument);
  const [unpairSso, { loading }] = useMutation(UnpairSsoDocument, REFETCH);
  const [actionError, setActionError] = useState<string | null>(null);
  const setup = data?.ssoSetup;

  if (setup === undefined) {
    return error ? <LoadFailure error={error} onRetry={() => refetch()} what="the sign-in setup" compact /> : null;
  }
  const name = setup.name ?? UNNAMED;

  async function disconnect() {
    setActionError(null);
    try {
      await unpairSso();
    } catch (cause) {
      setActionError(describeError(cause));
    }
  }

  if (setup.source === 'NONE') {
    return <PairSsoForm />;
  }

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap items-center justify-between gap-4">
        <View className="min-w-0 flex-1 basis-48 gap-1">
          <Text className="font-medium text-foreground">{`Sign in with ${name}`}</Text>
          {setup.source === 'ENV' ? (
            <Text className="text-foreground/60 text-sm">
              Set by <Code>OIDC_ISSUER</Code> in the server's environment, so it is changed there. Its redirect URI is{' '}
              <Code>{setup.redirectUri}</Code>.
            </Text>
          ) : (
            <Text className="text-foreground/60 text-sm">
              {setup.issuer ? `Paired with ${setup.issuer}.` : 'Paired.'}
            </Text>
          )}
        </View>
        {setup.source === 'PAIRED' ? (
          <ConfirmButton
            label="Disconnect"
            content="Disconnect"
            variant="destructive-outline"
            loading={loading}
            title={`Disconnect ${name}?`}
            description="Its button leaves the login page and Ethos's client is deleted at the provider. Accounts stay, and can still sign in with an emailed link."
            confirmLabel="Disconnect"
            onConfirm={() => void disconnect()}
          />
        ) : null}
      </View>
      {actionError ? <Alert variant="destructive" title="Could not disconnect" description={actionError} /> : null}
    </View>
  );
}
