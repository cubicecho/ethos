import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatDayLong } from '@/lib/periods';
import { SmallerVersionDialog } from '../smaller-version-dialog';
import { SmallerVersions } from '../smaller-versions';
import type { HabitEntrySummary } from '../types';

// A smaller version is a kept day with a note. What is asserted here is what
// the dialog hands back, and that the diary lists those days and no others.

const entry = (day: string, overrides: Partial<HabitEntrySummary> = {}): HabitEntrySummary => ({
  id: `entry-${day}`,
  day,
  status: 'done',
  note: null,
  partial: false,
  ...overrides,
});

function renderDialog(props: { note?: string | null; error?: string | null; recorded?: boolean } = {}) {
  const onSubmit = vi.fn(async () => props.recorded ?? true);
  const onOpenChange = vi.fn();
  render(
    <SmallerVersionDialog
      open
      onOpenChange={onOpenChange}
      habitName="Read"
      note={props.note ?? null}
      error={props.error ?? null}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe('SmallerVersionDialog', () => {
  it('hands back the note, trimmed, and closes', async () => {
    const { onSubmit, onOpenChange } = renderDialog();
    await userEvent.type(screen.getByLabelText('What did you do?'), '  One page  ');
    await userEvent.click(screen.getByRole('button', { name: 'Keep the day' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('One page'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the day with no note at all', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Keep the day' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(null));
  });

  it('starts from the note the day already has', () => {
    renderDialog({ note: 'One page' });
    expect(screen.getByLabelText('What did you do?')).toHaveProperty('value', 'One page');
  });

  it('stays open, and says why, when the day was refused', async () => {
    const { onSubmit, onOpenChange } = renderDialog({ recorded: false, error: 'That day has not happened yet.' });
    await userEvent.click(screen.getByRole('button', { name: 'Keep the day' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('alert').textContent).toBe('That day has not happened yet.');
  });
});

describe('SmallerVersions', () => {
  it('lists the smaller versions and leaves the other days out', () => {
    render(
      <SmallerVersions
        entries={[
          entry('2026-09-16', { partial: true, note: 'One page' }),
          entry('2026-09-15'),
          entry('2026-09-14', { partial: true }),
          entry('2026-09-13', { status: 'skipped' }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(formatDayLong('2026-09-16'))).toBeTruthy();
    expect(within(items[0]).getByText('One page')).toBeTruthy();
    expect(within(items[1]).getByText('No note.')).toBeTruthy();
  });
});
