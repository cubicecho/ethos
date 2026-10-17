import { useMutation, useQuery } from '@apollo/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { PairSsoForm } from '@/components/domain/sso/sso-settings';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
import { Form } from '@/components/ui/form';
import { CircleCheck } from '@/components/ui/icons';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { setToken } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { AuthConfigDocument, RequestSignInDocument, SsoSetupDocument } from '@/lib/graphql';

/** What `?error=` says when the provider's button was followed after it was disconnected. */
const SSO_OFF = 'sso_off';

/** The login page's two faces, while a new instance can still set sign-in up from here. */
const Mode = {
  SignIn: 'sign-in',
  SetUp: 'set-up',
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

/**
 * Asks for an address, and either emails it a sign-in link or signs it straight in. Where the
 * instance has an OIDC provider, its button comes first, and a sign-in there that failed comes back
 * here with `?error=`. A new instance, with no accounts and no provider, also offers to pair one,
 * so whoever installs it can set sign-in up before there is an admin to ask.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { error: ssoError } = useLocalSearchParams<{ error?: string }>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(Mode.SignIn);
  const [paired, setPaired] = useState<string | null>(null);
  const configQuery = useQuery(AuthConfigDocument);
  const setup = useQuery(SsoSetupDocument).data?.ssoSetup;
  const [requestSignIn, { error }] = useMutation(RequestSignInDocument);

  const config = configQuery.data?.authConfig;
  const sso = config?.sso ?? null;
  const isLocalNet = config?.secureLocalNet === true;
  // Only once the server has answered: a form that is merely still loading is not a broken instance.
  const cannotSignIn = config !== undefined && isLocalNet === false && config.magicLink === false && sso === null;
  const offerSetup = setup?.canPair === true && setup.source === 'NONE';

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

  const signInForm = (
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
              This instance has no way to sign anyone in. Whoever runs it needs to set <Code>SMTP_URL</Code>, an OpenID
              Connect provider, or <Code>SECURE_LOCAL_NET=true</Code> on a private network.
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
  );

  return (
    <CenteredLayout
      className="bg-background"
      level={1}
      title="Ethos"
      description="Habits, and the days you keep them."
      contentClassName="gap-4"
      contentSlot={
        <>
          {offerSetup ? (
            <SegmentedGroup
              aria-label="Sign in or set up"
              value={mode}
              onValueChange={(next) => setMode(next as Mode)}
              className="self-center"
            >
              <SegmentedButton value={Mode.SignIn}>Sign in</SegmentedButton>
              <SegmentedButton value={Mode.SetUp}>Set up sign-in</SegmentedButton>
            </SegmentedGroup>
          ) : null}

          {offerSetup && mode === Mode.SetUp ? (
            <>
              <Text className="text-foreground/60 text-sm">
                Pair Ethos with an OpenID Connect provider, such as heautou, and its button joins the emailed link here.
                Paste the setup URL its admin made for Ethos.
              </Text>
              <PairSsoForm
                onPaired={(name) => {
                  setPaired(name);
                  setMode(Mode.SignIn);
                }}
              />
            </>
          ) : (
            <>
              {paired ? (
                <Alert
                  variant="info"
                  title={`Paired with ${paired}`}
                  description="Sign in with it below. The first account to sign in runs this instance."
                />
              ) : null}
              {ssoError === SSO_OFF ? (
                <Alert
                  variant="warning"
                  title="That sign-in button is gone"
                  description="This instance no longer signs in through a provider. Use an emailed link instead."
                />
              ) : ssoError ? (
                <Alert
                  variant="destructive"
                  title={sso ? `Signing in with ${sso.name} didn't work` : "Signing in didn't work"}
                  description={`The provider answered ${ssoError}. Try again, or ask whoever runs this instance.`}
                />
              ) : null}
              {sso ? (
                <>
                  {/* A plain link, not the router's: the server sends the browser on to the provider. */}
                  <Button content={`Sign in with ${sso.name}`} linkSlot={<a href={sso.signInUrl} />} />
                  <Text className="text-center text-foreground/60 text-sm">or sign in by email</Text>
                </>
              ) : null}
              {signInForm}
            </>
          )}
        </>
      }
    />
  );
}
