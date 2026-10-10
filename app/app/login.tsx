import { useMutation, useQuery } from '@apollo/client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { Form } from '@/components/ui/form';
import { CircleCheck } from '@/components/ui/icons';
import { setToken } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { AuthConfigDocument, RequestSignInDocument } from '@/lib/graphql';

/** Asks for an address, and either emails it a sign-in link or signs it straight in. */
export default function LoginScreen() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const configQuery = useQuery(AuthConfigDocument);
  const [requestSignIn, { error }] = useMutation(RequestSignInDocument);

  const config = configQuery.data?.authConfig;
  const isLocalNet = config?.secureLocalNet === true;
  // Only once the server has answered: a form that is merely still loading is not a broken instance.
  const cannotSignIn = config !== undefined && isLocalNet === false && config.magicLink === false;

  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: ({ value }) => send(value.email.trim()),
  });

  async function send(email: string) {
    setSentTo(null);
    try {
      const { data } = await requestSignIn({ variables: { email } });
      const result = data?.requestSignIn;
      if (!result) {
        return;
      }
      // Under SECURE_LOCAL_NET the server answers with a session instead of sending a link.
      if (result.session) {
        setToken(result.session.token);
        router.replace('/');
        return;
      }
      setSentTo(email);
    } catch {
      // Rendered from `error` below.
    }
  }

  return (
    <CenteredLayout
      className="bg-background"
      level={1}
      title="Ethos"
      description="Habits, and the days you keep them."
      contentClassName="gap-4"
      contentSlot={
        <>
          <form.AppForm>
            <Form className="gap-4">
              <form.AppField
                name="email"
                validators={{ onChange: ({ value }) => (value.trim() === '' ? 'Enter your email.' : undefined) }}
              >
                {(field) => <field.InputField label="Email" type="email" placeholder="you@example.com" />}
              </form.AppField>
              <form.SubmitButton
                createLabel={isLocalNet ? 'Sign in' : 'Send sign-in link'}
                savingLabel={isLocalNet ? 'Signing in…' : 'Sending…'}
              />
            </Form>
          </form.AppForm>

          {configQuery.error ? <Alert variant="destructive" description={describeError(configQuery.error)} /> : null}
          {error ? <Alert variant="destructive" description={describeError(error)} /> : null}

          {cannotSignIn ? (
            <Alert
              variant="destructive"
              title="Sign-in is not set up"
              description={
                <>
                  This instance has no way to send a sign-in link. Whoever runs it needs to set <Code>SMTP_URL</Code>,
                  or <Code>SECURE_LOCAL_NET=true</Code> on a private network.
                </>
              }
            />
          ) : null}

          {sentTo ? (
            <Alert
              iconSlot={<CircleCheck />}
              title="Check your email"
              description={`A sign-in link is on its way to ${sentTo}. It works once, and for 15 minutes.`}
            />
          ) : null}
        </>
      }
    />
  );
}
