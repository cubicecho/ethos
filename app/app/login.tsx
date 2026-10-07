import { useMutation } from '@apollo/client';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { Form } from '@/components/ui/form';
import { CircleCheck } from '@/components/ui/icons';
import { setToken } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { RequestMagicLinkDocument } from '@/lib/graphql';

/** Asks for an address and sends it a sign-in link. */
export default function LoginScreen() {
  const router = useRouter();
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [hasSentLink, setHasSentLink] = useState(false);
  const [requestMagicLink, { error }] = useMutation(RequestMagicLinkDocument);

  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: ({ value }) => send(value.email.trim()),
  });

  async function send(email: string) {
    setHasSentLink(false);
    setMagicLink(null);
    try {
      const { data } = await requestMagicLink({ variables: { email } });
      const result = data?.requestMagicLink;
      if (!result) {
        return;
      }
      // With AUTH_MAGIC_LINK=false the server hands back a live session instead of
      // a link, so the client keeps one code path and stores whatever it gets.
      if (result.token) {
        setToken(result.token);
        router.replace('/');
        return;
      }
      setMagicLink(result.magicLink ?? null);
      setHasSentLink(true);
    } catch {
      // Rendered from `error` below.
    }
  }

  return (
    <CenteredLayout
      className="bg-background"
      level={1}
      title="Ethos"
      description="Habits, the days you keep them, and the streak that follows."
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
              <form.SubmitButton createLabel="Send sign-in link" savingLabel="Sending…" />
            </Form>
          </form.AppForm>

          {error ? <Alert variant="destructive" description={describeError(error)} /> : null}

          {hasSentLink ? (
            <Alert
              iconSlot={<CircleCheck />}
              title="Sign-in link sent"
              description={
                magicLink ? (
                  <>
                    This instance has no mail relay, so the link is shown here and printed to the server log.{' '}
                    <Link href={magicLink} className="break-all text-info text-sm underline">
                      {magicLink}
                    </Link>
                  </>
                ) : (
                  /* Not "check your inbox": Ethos ships no mail relay, so nothing
                     was ever sent anywhere. The link is in the server log, and
                     saying so is the difference between a reader waiting for an
                     email that will not come and one who knows where to look. */
                  <>
                    This instance sends no mail — the link was written to the server log. Whoever runs it can read it
                    from there, or set <Code>EXPOSE_MAGIC_LINK=true</Code> to show it on this page.
                  </>
                )
              }
            />
          ) : null}
        </>
      }
    />
  );
}
