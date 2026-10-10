import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { CreateHabitDocument, UpdateHabitDocument } from '@/lib/graphql';
import { PALETTE } from '@/lib/palette';
import { habit, renderWithApollo, TODAY } from '../../__tests__/helpers';
import { HabitFormDialog } from '../habit-form-dialog';
import type { HabitSummary } from '../types';

// The form is the first place an impossible cadence can be refused, and the
// place a new habit's id is minted. Both are asserted by what leaves the form,
// since the server's copy of each rule is the one that decides.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Variables = Record<string, unknown>;

/**
 * A `createHabit` that accepts whatever it is sent and answers with it, as the server would.
 *
 * @returns The mock, and the spy holding the variables it was sent.
 */
function createMock() {
  const result = vi.fn((variables: Variables) => ({
    data: { createHabit: habit(variables.values as Partial<HabitSummary>) },
  }));
  const mock: MockedResponse = { request: { query: CreateHabitDocument }, variableMatcher: () => true, result };
  return { mock, result };
}

/**
 * An `updateHabit` that accepts whatever it is sent.
 *
 * @returns The mock, and the spy holding the variables it was sent.
 */
function updateMock() {
  const result = vi.fn((variables: Variables) => ({
    data: { updateHabit: habit(variables.set as Partial<HabitSummary>) },
  }));
  const mock: MockedResponse = { request: { query: UpdateHabitDocument }, variableMatcher: () => true, result };
  return { mock, result };
}

function renderDialog(
  props: Partial<Parameters<typeof HabitFormDialog>[0]> = {},
  mocks: readonly MockedResponse[] = [],
) {
  const onOpenChange = vi.fn();
  renderWithApollo(<HabitFormDialog open onOpenChange={onOpenChange} today={TODAY} {...props} />, mocks);
  return { onOpenChange, user: userEvent.setup() };
}

const nameField = () => screen.getByRole('textbox', { name: 'Name' });
const cadence = (label: string) => screen.getByRole('radio', { name: label });
const submit = (label = 'Create') => screen.getByRole('button', { name: label });

/**
 * What a mock was sent, once it has been sent.
 *
 * @param result - The mock's spy.
 * @returns The variables of the one request.
 */
async function sentTo(result: Mock<(variables: Variables) => unknown>): Promise<Variables> {
  await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  return result.mock.calls[0]?.[0] ?? {};
}

/**
 * Asserts the form will not be sent: its submit is disabled, and Enter in the name sends nothing.
 *
 * No test that calls this gives Apollo a mock, so a request sent anyway would
 * fail and the footer would read the failure out beside the field's message.
 *
 * @param user - The test's user.
 * @param onOpenChange - The dialog's spy: a save would have closed it.
 * @param [label] - The submit button's label.
 */
async function refused(user: ReturnType<typeof userEvent.setup>, onOpenChange: () => void, label = 'Create') {
  expect(submit(label)).toBeDisabled();
  await user.type(nameField(), '{Enter}');
  expect(onOpenChange).not.toHaveBeenCalled();
  // The field's own message is the one alert; a failed request would be a second.
  expect(screen.getAllByRole('alert')).toHaveLength(1);
}

describe('HabitFormDialog creating a habit', () => {
  it('starts as a daily habit with no number to pick', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'New habit' })).toBeInTheDocument();
    expect(cadence('Daily')).toBeChecked();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('sends a client-generated id with the new habit, and closes', async () => {
    const { mock, result } = createMock();
    const { onOpenChange, user } = renderDialog({ nextPosition: 4 }, [mock]);

    await user.type(nameField(), '  Run  ');
    await user.click(submit());

    const variables = await sentTo(result);
    expect(variables).toEqual({
      today: TODAY,
      values: {
        id: expect.stringMatching(UUID),
        name: 'Run',
        notes: null,
        color: PALETTE[0],
        period: 'day',
        targetCount: 1,
        position: 4,
      },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false));
  });

  it('sends the notes trimmed when there are some', async () => {
    const { mock, result } = createMock();
    const { user } = renderDialog({}, [mock]);

    await user.type(nameField(), 'Run');
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), ' Around the park. ');
    await user.click(submit());

    expect(await sentTo(result)).toMatchObject({ values: { notes: 'Around the park.' } });
  });

  it('refuses a habit with no name, and sends nothing', async () => {
    const { onOpenChange, user } = renderDialog();

    await user.type(nameField(), '   ');

    expect(await screen.findByText('Give the habit a name.')).toBeInTheDocument();
    await refused(user, onOpenChange);
  });

  it('asks how many times once the cadence is not daily', async () => {
    const { mock, result } = createMock();
    const { user } = renderDialog({}, [mock]);

    await user.type(nameField(), 'Run');
    await user.click(cadence('Weekly'));
    const times = screen.getByRole('spinbutton', { name: 'Times per week' });
    await user.clear(times);
    await user.type(times, '3');
    await user.click(submit());

    expect(await sentTo(result)).toMatchObject({ values: { period: 'week', targetCount: 3 } });
  });

  it.each([
    { label: 'Weekly', field: 'Times per week', over: '8', refusal: /week has at most 7 days/ },
    { label: 'Monthly', field: 'Times per month', over: '29', refusal: /month has at most 28 days/ },
  ])('refuses a $label target no period could hold, and sends nothing', async ({ label, field, over, refusal }) => {
    const { onOpenChange, user } = renderDialog();

    await user.type(nameField(), 'Run');
    await user.click(cadence(label));
    const times = screen.getByRole('spinbutton', { name: field });
    await user.clear(times);
    await user.type(times, over);

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    await refused(user, onOpenChange);
  });

  it('accepts the most a month can hold in February', async () => {
    const { mock, result } = createMock();
    const { user } = renderDialog({}, [mock]);

    await user.type(nameField(), 'Run');
    await user.click(cadence('Monthly'));
    const times = screen.getByRole('spinbutton', { name: 'Times per month' });
    await user.clear(times);
    await user.type(times, '28');
    await user.click(submit());

    expect(await sentTo(result)).toMatchObject({ values: { period: 'month', targetCount: 28 } });
  });

  it('refuses an empty target rather than guessing one', async () => {
    const { onOpenChange, user } = renderDialog();

    await user.type(nameField(), 'Run');
    await user.click(cadence('Weekly'));
    await user.clear(screen.getByRole('spinbutton', { name: 'Times per week' }));

    expect(await screen.findByText('Enter a whole number.')).toBeInTheDocument();
    await refused(user, onOpenChange);
  });

  it('brings a target down to what a shorter period can hold', async () => {
    const { user } = renderDialog();

    await user.click(cadence('Monthly'));
    const times = screen.getByRole('spinbutton', { name: 'Times per month' });
    await user.clear(times);
    await user.type(times, '20');
    await user.click(cadence('Weekly'));

    expect(screen.getByRole('spinbutton', { name: 'Times per week' })).toHaveValue(7);
  });

  it('sends one a day when the cadence goes back to daily', async () => {
    const { mock, result } = createMock();
    const { user } = renderDialog({}, [mock]);

    await user.type(nameField(), 'Run');
    await user.click(cadence('Weekly'));
    const times = screen.getByRole('spinbutton', { name: 'Times per week' });
    await user.clear(times);
    await user.type(times, '5');
    await user.click(cadence('Daily'));
    await user.click(submit());

    expect(await sentTo(result)).toMatchObject({ values: { period: 'day', targetCount: 1 } });
  });

  it('sends the colour that was picked', async () => {
    const { mock, result } = createMock();
    const { user } = renderDialog({}, [mock]);

    await user.type(nameField(), 'Run');
    await user.click(screen.getByRole('radio', { name: PALETTE[2] }));
    await user.click(submit());

    expect(await sentTo(result)).toMatchObject({ values: { color: PALETTE[2] } });
  });

  it('stays open with what was typed, and says why, when the server refuses', async () => {
    const refusal: MockedResponse = {
      request: { query: CreateHabitDocument },
      variableMatcher: () => true,
      result: { errors: [{ message: 'A month has at most 28 days to keep it on.' }] },
    };
    const { onOpenChange, user } = renderDialog({}, [refusal]);

    await user.type(nameField(), 'Run');
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 28 days/);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(nameField()).toHaveValue('Run');
  });

  it('closes without sending when cancelled', async () => {
    const { onOpenChange, user } = renderDialog();

    await user.type(nameField(), 'Run');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('HabitFormDialog editing a habit', () => {
  const weekly = habit({ name: 'Read', notes: 'Twenty pages.', period: 'week', targetCount: 3, color: PALETTE[1] });

  it('starts from the habit as it is', () => {
    renderDialog({ habit: weekly });
    expect(screen.getByRole('dialog', { name: 'Edit habit' })).toBeInTheDocument();
    expect(nameField()).toHaveValue('Read');
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Twenty pages.');
    expect(cadence('Weekly')).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Times per week' })).toHaveValue(3);
    expect(screen.getByRole('radio', { name: PALETTE[1] })).toBeChecked();
  });

  it('updates the habit it was given, under its own id, and closes', async () => {
    const { mock, result } = updateMock();
    const { onOpenChange, user } = renderDialog({ habit: weekly }, [mock]);

    await user.clear(nameField());
    await user.type(nameField(), 'Read more');
    await user.click(submit('Save'));

    expect(await sentTo(result)).toEqual({
      id: 'habit-1',
      today: TODAY,
      set: { name: 'Read more', notes: 'Twenty pages.', color: PALETTE[1], period: 'week', targetCount: 3 },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false));
  });

  it('clears the notes with null rather than an empty string', async () => {
    const { mock, result } = updateMock();
    const { user } = renderDialog({ habit: weekly }, [mock]);

    await user.clear(screen.getByRole('textbox', { name: 'Notes' }));
    await user.click(submit('Save'));

    expect(await sentTo(result)).toMatchObject({ set: { notes: null } });
  });

  it('refuses a target the habit’s new period cannot hold', async () => {
    const { onOpenChange, user } = renderDialog({ habit: weekly });

    const times = screen.getByRole('spinbutton', { name: 'Times per week' });
    await user.clear(times);
    await user.type(times, '9');

    expect(await screen.findByText(/week has at most 7 days/)).toBeInTheDocument();
    await refused(user, onOpenChange, 'Save');
  });
});
