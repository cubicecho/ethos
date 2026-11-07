import type { ComponentProps } from 'react';
import { LoadState as CubeuiLoadState, LoadError, type LoadStateProps } from '@/components/load-state';
import { describeError } from '@/lib/errors';

/**
 * What a screen shows when the data it needs did not arrive.
 *
 * An empty state means the server said "none", never that we failed to ask, and
 * a failure the reader can only answer by reloading is barely better than a
 * blank page. This is cubeui's `LoadError` worded through `describeError`, so
 * the reader sees "Your session has expired" rather than the transport's status
 * code. A list takes `LoadState`, which adds the loading and empty rungs.
 */
export function LoadFailure(props: Omit<ComponentProps<typeof LoadError>, 'describe'>) {
  return <LoadError describe={describeError} {...props} />;
}

/** `Omit` over each arm of a union, where the plain one would merge the arms into one. */
type OmitEach<Props, Key extends PropertyKey> = Props extends unknown ? Omit<Props, Key> : never;

/** What `LoadState` reads off an Apollo `useQuery` result. */
type ApolloResult = {
  loading: boolean;
  error?: unknown;
  data?: unknown;
  refetch: () => unknown;
};

/**
 * cubeui's `LoadState` over an Apollo result: failed, loading, or empty,
 * worded like `LoadFailure`, and nothing once there are rows.
 *
 * Pending and failed both mean *nothing to show*, not merely that a request is
 * out or went wrong. Apollo keeps rendering what it had while it refetches, and
 * a refetch that fails with the last good list still on screen should leave the
 * list there: replacing it with an apology would take away the rows the reader
 * was using, for a failure they did not ask about.
 */
export function LoadState({
  query,
  ...props
}: OmitEach<LoadStateProps, 'describe' | 'query'> & { query: ApolloResult }) {
  const nothing = query.data === undefined;
  return (
    <CubeuiLoadState
      query={{
        isPending: query.loading && nothing,
        isError: query.error != null && nothing,
        error: query.error,
        refetch: query.refetch,
      }}
      describe={describeError}
      {...props}
    />
  );
}
