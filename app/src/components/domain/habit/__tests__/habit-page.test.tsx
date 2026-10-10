import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Text } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteHabitDocument, UpdateHabitDocument } from '@/lib/graphql';
import { habit, renderWithApollo, TODAY, tally } from '../../__tests__/helpers';
import { HabitPage } from '../habit-page';
import type { HabitSummary } from '../types';

// A habit's header: what it is, what this period came to, and the three things
// that can be done to it. Archiving keeps the days and deleting does not, so
// the two are asserted apart.

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('expo-router', () => ({ useRouter: () => router }));

const ARCHIVED_AT = '2026-09-01T08:00:00.000Z';

function renderPage(subject: HabitSummary = habit(), mocks: readonly MockedResponse[] = []) {
  return renderWithApollo(<HabitPage habit={subject} today={TODAY} contentSlot={<Text>The grid</Text>} />, mocks);
}

const button = (name: string) => screen.getByRole('button', { name });

describe('HabitPage', () => {
  beforeEach(() => {
    router.replace.mockClear();
  });

  it('heads the page with the habit’s name and cadence, over what the route gave it', () => {
    renderPage(habit({ period: 'week', targetCount: 3 }));
    expect(screen.getByRole('heading', { name: 'Read' })).toBeInTheDocument();
    expect(screen.getByText(/3.*week/i)).toBeInTheDocument();
    expect(screen.getByText('The grid')).toBeInTheDocument();
  });

  it('prints the server’s tally for the period in progress', () => {
    renderPage(habit({ period: 'week', targetCount: 3, current: tally({ done: 2, target: 3, effectiveTarget: 3 }) }));
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('counts against what is still owed once a day has been skipped, and says why', () => {
    renderPage(
      habit({
        period: 'week',
        targetCount: 3,
        current: tally({ done: 1, skipped: 1, target: 3, effectiveTarget: 2 }),
      }),
    );
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument();
  });

  it('shows no streak, no best run and no percentage', () => {
    renderPage(habit({ current: tally({ done: 1, met: true }) }));
    expect(document.body).not.toHaveTextContent(/streak|best|%/i);
  });

  it('shows the notes when the habit has some', () => {
    renderPage(habit({ notes: 'Twenty pages.' }));
    expect(screen.getByText('Twenty pages.')).toBeInTheDocument();
  });

  it('opens the form on the habit when edited', async () => {
    renderPage();
    await userEvent.click(button('Edit habit'));

    const dialog = await screen.findByRole('dialog', { name: 'Edit habit' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Read');
  });

  it('archives by stamping the habit, and stays on the page', async () => {
    const sent = vi.fn((_variables: Record<string, unknown>) => true);
    const result = vi.fn(() => ({ data: { updateHabit: habit({ archivedAt: ARCHIVED_AT }) } }));
    renderPage(habit(), [{ request: { query: UpdateHabitDocument }, variableMatcher: sent, result }]);

    await userEvent.click(button('Archive habit'));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
    const [variables] = sent.mock.calls[0] ?? [];
    expect(variables).toMatchObject({ id: 'habit-1', today: TODAY });
    const { archivedAt } = (variables?.set ?? {}) as { archivedAt?: unknown };
    expect(Number.isNaN(Date.parse(String(archivedAt)))).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says an archived habit is archived, and offers to restore it instead', async () => {
    const result = vi.fn(() => ({ data: { updateHabit: habit() } }));
    renderPage(habit({ archivedAt: ARCHIVED_AT }), [
      {
        request: { query: UpdateHabitDocument, variables: { id: 'habit-1', set: { archivedAt: null }, today: TODAY } },
        result,
      },
    ]);

    expect(screen.getByText(/Archived/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive habit' })).not.toBeInTheDocument();
    await userEvent.click(button('Restore habit'));

    await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  });

  it('reads out why an archive was refused', async () => {
    renderPage(habit(), [
      {
        request: { query: UpdateHabitDocument },
        variableMatcher: () => true,
        result: { errors: [{ message: 'Habit not found.' }] },
      },
    ]);

    await userEvent.click(button('Archive habit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
  });

  it('asks before deleting, and deletes nothing when the reader backs out', async () => {
    // No mock: a delete sent anyway would fail, and the page would say so.
    renderPage();
    await userEvent.click(button('Delete habit'));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Read');
    await userEvent.click(button('Cancel'));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('deletes once confirmed, then leaves for Today', async () => {
    const result = vi.fn(() => ({ data: { deleteHabit: { __typename: 'Habit', id: 'habit-1' } } }));
    renderPage(habit(), [{ request: { query: DeleteHabitDocument, variables: { id: 'habit-1' } }, result }]);

    await userEvent.click(button('Delete habit'));
    await screen.findByRole('alertdialog');
    await userEvent.click(button('Delete'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/'));
    expect(result).toHaveBeenCalledTimes(1);
  });

  it('stays on the habit and says why when the delete is refused', async () => {
    renderPage(habit(), [
      {
        request: { query: DeleteHabitDocument, variables: { id: 'habit-1' } },
        result: { errors: [{ message: 'Habit not found.' }] },
      },
    ]);

    await userEvent.click(button('Delete habit'));
    await screen.findByRole('alertdialog');
    await userEvent.click(button('Delete'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
