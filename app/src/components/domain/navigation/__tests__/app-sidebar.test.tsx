import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HabitSummary } from '@/components/domain/habit/types';
import { clearToken } from '@/lib/auth';
import { CreateHabitDocument, HabitsDocument } from '@/lib/graphql';
import { habit, renderWithApollo, TODAY } from '../../__tests__/helpers';
import { AppSidebar } from '../app-sidebar';

// The rail is how the reader gets anywhere, so what is asserted is that it
// lists what the server said, says which page is on screen, and never trades a
// list it could not load for "you have none".

const route = vi.hoisted(() => ({ pathname: '/' }));

// `asChild` is how the real `Link` hands its `href` to the row inside it.
vi.mock('expo-router', () => ({
  usePathname: () => route.pathname,
  Link: ({ href, asChild, children }: { href: string; asChild?: boolean; children: ReactNode }) =>
    asChild ? cloneElement(children as ReactElement<{ href: string }>, { href }) : <a href={href}>{children}</a>,
}));

vi.mock('@/lib/use-today', () => ({ useToday: () => '2026-09-17' }));

vi.mock('@/lib/auth', () => ({ clearToken: vi.fn() }));

const READ = habit();
const RUN = habit({ id: 'habit-2', name: 'Run', position: 1 });

/**
 * The rail's query, answered.
 *
 * @param habits - What the server lists.
 * @returns The mock.
 */
const habitsMock = (habits: readonly HabitSummary[]): MockedResponse => ({
  request: { query: HabitsDocument, variables: { today: TODAY } },
  result: { data: { habits } },
});

const habitsNav = () => screen.getByRole('navigation', { name: 'Habits' });

describe('AppSidebar', () => {
  beforeEach(() => {
    route.pathname = '/';
    vi.mocked(clearToken).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links to every screen of the app', () => {
    renderWithApollo(<AppSidebar />, [habitsMock([])]);
    const rail = screen.getByRole('complementary', { name: 'Ethos' });
    expect(within(rail).getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/');
    expect(within(rail).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/overview');
    expect(within(rail).getByRole('link', { name: 'Archive' })).toHaveAttribute('href', '/archive');
    expect(within(rail).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('lists today’s habits as links to their own pages, in the server’s order', async () => {
    renderWithApollo(<AppSidebar />, [habitsMock([READ, RUN])]);

    expect(await screen.findByRole('link', { name: 'Read' })).toHaveAttribute('href', '/habits/habit-1');
    const links = within(habitsNav()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/habits/habit-1', '/habits/habit-2']);
  });

  it('names a habit by its name alone, with no streak or count beside it', async () => {
    renderWithApollo(<AppSidebar />, [habitsMock([READ, RUN])]);

    await screen.findByRole('link', { name: 'Read' });
    expect(within(habitsNav()).getAllByRole('link')).toHaveLength(2);
    expect(within(habitsNav()).getByRole('link', { name: 'Run' })).toHaveTextContent(/^Run$/);
  });

  it('marks Today as the page on screen at the root', async () => {
    renderWithApollo(<AppSidebar />, [habitsMock([READ])]);

    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('link', { name: 'Read' })).not.toHaveAttribute('aria-current');
  });

  it('marks the habit on screen, and only that one', async () => {
    route.pathname = '/habits/habit-2';
    renderWithApollo(<AppSidebar />, [habitsMock([READ, RUN])]);

    expect(await screen.findByRole('link', { name: 'Run' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Read' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current');
  });

  it('says it is loading before the list arrives, not that there are none', () => {
    renderWithApollo(<AppSidebar />, [{ ...habitsMock([READ]), delay: 1000 }]);
    expect(within(habitsNav()).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('No habits yet.')).not.toBeInTheDocument();
  });

  it('says there are none once the server said so', async () => {
    renderWithApollo(<AppSidebar />, [habitsMock([])]);
    expect(await screen.findByText('No habits yet.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a list it could not load as a failure, and keeps the rest of the rail', async () => {
    renderWithApollo(<AppSidebar />, [
      { request: { query: HabitsDocument, variables: { today: TODAY } }, error: new Error('Failed to fetch') },
    ]);

    expect(await within(habitsNav()).findByRole('alert')).toHaveTextContent('your habits');
    expect(screen.queryByText('No habits yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('creates a habit after the last one, and lists it without asking again', async () => {
    const created = vi.fn((variables: Record<string, unknown>) => ({
      data: { createHabit: habit(variables.values as Partial<HabitSummary>) },
    }));
    // One answer for the list: a refetch would find no mock and fail.
    renderWithApollo(<AppSidebar />, [
      habitsMock([READ, RUN]),
      { request: { query: CreateHabitDocument }, variableMatcher: () => true, result: created },
    ]);
    await screen.findByRole('link', { name: 'Run' });

    await userEvent.click(screen.getByRole('button', { name: 'New habit' }));
    const dialog = await screen.findByRole('dialog', { name: 'New habit' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Stretch');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0]?.[0]).toMatchObject({ today: TODAY, values: { name: 'Stretch', position: 2 } });
    expect(await within(habitsNav()).findByRole('link', { name: 'Stretch' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('drops the session and leaves for the login page on sign out', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    renderWithApollo(<AppSidebar />, [habitsMock([])]);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledExactlyOnceWith('/login');
  });
});
