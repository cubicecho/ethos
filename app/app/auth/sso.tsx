import { useMutation } from '@apollo/client';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { CenteredLayout } from '@/components/centered-layout';
import { CircleAlert } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { setToken } from '@/lib/auth';
import { describeError } from '@/lib/errors';
import { VerifyOneTimeTokenDocument } from '@/lib/graphql';

/**
 * Where a sign-in through the OIDC provider lands. The server's callback opened a session and put
 * a one-time token for it on this URL; this swaps the token for the session, once.
 */
export default function SsoScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [verifyOneTimeToken, { error }] = useMutation(VerifyOneTimeTokenDocument);
  // The token is spent on first use, and strict mode runs effects twice.
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current || !token) {
      return;
    }
    hasStarted.current = true;
    verifyOneTimeToken({ variables: { token } })
      .then(({ data }) => {
        if (!data?.verifyOneTimeToken) {
          return;
        }
        setToken(data.verifyOneTimeToken.token);
        router.replace('/');
      })
      .catch(() => {
        // Rendered from `error` below.
      });
  }, [token, verifyOneTimeToken, router]);

  const failure = token ? (error ? describeError(error) : null) : 'The sign-in came back without its token.';

  if (failure) {
    return (
      <CenteredLayout
        className="bg-background"
        level={1}
        iconSlot={<CircleAlert className="size-4" />}
        title="That sign-in didn't work"
        description={`${failure} A sign-in has to be finished within a few minutes, and only once.`}
        footerSlot={
          <Link href="/login" className="text-info text-sm underline">
            Try again
          </Link>
        }
      />
    );
  }

  return <CenteredLayout className="bg-background" level={1} iconSlot={<Spinner />} title="Signing you in…" />;
}
