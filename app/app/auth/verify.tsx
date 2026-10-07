import { useMutation } from '@apollo/client';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { CenteredLayout } from '@/components/centered-layout';
import { CircleAlert } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { setToken } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { VerifyMagicLinkDocument } from '@/lib/graphql';

/** Spends the token of a sign-in link and opens the app. */
export default function VerifyScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [verifyMagicLink, { error }] = useMutation(VerifyMagicLinkDocument);
  // Strict mode and route re-renders both run effects more than once; a magic
  // token is meant to be spent exactly once.
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current || !token) {
      return;
    }
    hasStarted.current = true;
    verifyMagicLink({ variables: { token } })
      .then(({ data }) => {
        if (!data?.verifyMagicLink) {
          return;
        }
        setToken(data.verifyMagicLink.token);
        router.replace('/');
      })
      .catch(() => {
        // Rendered from `error` below.
      });
  }, [token, verifyMagicLink, router]);

  const failure = token ? (error ? describeError(error) : null) : 'The link is missing its token.';

  if (failure) {
    return (
      <CenteredLayout
        className="bg-background"
        level={1}
        iconSlot={<CircleAlert className="size-4" />}
        title="That link didn't work"
        description={`${failure} Sign-in links expire after 15 minutes.`}
        footerSlot={
          <Link href="/login" className="text-info text-sm underline">
            Request a new one
          </Link>
        }
      />
    );
  }

  return <CenteredLayout className="bg-background" level={1} iconSlot={<Spinner />} title="Signing you in…" />;
}
