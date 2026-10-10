import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { LoadFailure, LoadState } from '../load-state';

// The order of the rungs is the rule: failed, then loading, then empty, and
// none of them once there is something on screen.

type Query = Parameters<typeof LoadState>[0]['query'];

const EMPTY = 'No habits yet.';
const FAILED = new Error('Habit not found');

function renderState(query: Partial<Query>, count = 0) {
  const refetch = vi.fn();
  render(
    <LoadState
      query={{ loading: false, refetch, ...query }}
      what="your habits"
      count={count}
      emptySlot={<Text>{EMPTY}</Text>}
    />,
  );
  return { refetch };
}

describe('LoadState', () => {
  it('says it is loading before the first answer', () => {
    renderState({ loading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it('shows the empty state once the server said "none"', () => {
    renderState({ data: { habits: [] } });
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failure rather than an empty list when the answer never arrived', () => {
    // Nothing came back, so the count is zero — and that must not read as "none".
    renderState({ error: FAILED });
    expect(screen.getByRole('alert')).toHaveTextContent('your habits');
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it('reports a failure ahead of loading when a retry is under way', () => {
    renderState({ error: FAILED, loading: true });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('words the failure through describeError', () => {
    renderState({ error: { networkError: { statusCode: 401 } } });
    expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/);
  });

  it('draws nothing once there are rows', () => {
    renderState({ data: { habits: [{}] } }, 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it('leaves the rows alone when a refetch fails with data on screen', () => {
    renderState({ error: FAILED, data: { habits: [{}] } }, 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the rows alone while a refetch is out', () => {
    renderState({ loading: true, data: { habits: [{}] } }, 1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks again when the reader retries', async () => {
    const { refetch } = renderState({ error: FAILED });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('LoadFailure', () => {
  it('says what could not be loaded, and why, in the app’s words', () => {
    render(<LoadFailure error={new Error('Failed to fetch')} onRetry={vi.fn()} what="this habit" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('this habit');
    expect(alert).toHaveTextContent(/reach the server/);
  });
});
