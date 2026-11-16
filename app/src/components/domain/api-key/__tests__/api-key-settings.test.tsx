import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeysDocument, CreateApiKeyDocument, DeleteApiKeyDocument } from '@/lib/graphql';
import { renderWithApollo } from '../../__tests__/helpers';
import { ApiKeySettings } from '../api-key-settings';

// Settings' API keys card. What is asserted is what the server is sent, and
// that the key is shown once and only in the dialog that minted it.

const KEY = {
  __typename: 'ApiKey',
  id: 'key-1',
  name: 'auto-cal',
  start: 'ethos_ab',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastRequest: null,
  expiresAt: null,
};

const SECRET = 'ethos_abcdefghijklmnop';

/**
 * The list query, answered with these keys.
 *
 * @param keys - The keys the server holds.
 * @returns The mock.
 */
const listed = (keys: readonly (typeof KEY)[]): MockedResponse => ({
  request: { query: ApiKeysDocument },
  result: { data: { apiKeys: keys } },
});

/** The card's buttons, by name. */
const button = (name: string) => screen.getByRole('button', { name });

describe('ApiKeySettings', () => {
  it('lists the keys, saying how each is told apart and whether it has been used', async () => {
    renderWithApollo(<ApiKeySettings />, [listed([KEY])]);
    expect(await screen.findByText('auto-cal')).toBeInTheDocument();
    expect(screen.getByText(/ethos_ab…/)).toBeInTheDocument();
    expect(screen.getByText(/never used/)).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    renderWithApollo(<ApiKeySettings />, [listed([])]);
    expect(await screen.findByText('No keys yet.')).toBeInTheDocument();
  });

  it('names a key, mints it, and shows it once', async () => {
    const user = userEvent.setup();
    const result = vi.fn(() => ({
      data: { createApiKey: { __typename: 'AuthCreateApiKeyResult', id: 'key-2', key: SECRET } },
    }));
    const mint: MockedResponse = {
      request: { query: CreateApiKeyDocument, variables: { name: 'Dashboard', expiresIn: null } },
      result,
    };
    renderWithApollo(<ApiKeySettings />, [listed([]), mint, listed([KEY])]);

    await user.click(await screen.findByRole('button', { name: 'New key' }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), '  Dashboard  ');
    await user.click(button('Create key'));

    const dialog = await screen.findByRole('dialog', { name: 'Your new key' });
    expect(within(dialog).getByText(SECRET)).toBeInTheDocument();
    expect(result).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());
  });

  it('will not mint a key with no name', async () => {
    const user = userEvent.setup();
    renderWithApollo(<ApiKeySettings />, [listed([])]);
    await user.click(await screen.findByRole('button', { name: 'New key' }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), '   ');
    expect(button('Create key')).toBeDisabled();
  });

  it('revokes a key once confirmed, and takes it off the list', async () => {
    const user = userEvent.setup();
    const result = vi.fn(() => ({ data: { deleteApiKey: { __typename: 'AuthDeleteApiKeyResult', success: true } } }));
    renderWithApollo(<ApiKeySettings />, [
      listed([KEY]),
      { request: { query: DeleteApiKeyDocument, variables: { keyId: KEY.id } }, result },
    ]);

    await user.click(await screen.findByRole('button', { name: 'Revoke auto-cal' }));
    await screen.findByRole('alertdialog');
    await user.click(button('Revoke'));

    await waitFor(() => expect(screen.queryByText('auto-cal')).not.toBeInTheDocument());
    expect(result).toHaveBeenCalledTimes(1);
  });

  it('keeps the key and says why when the revoke is refused', async () => {
    const user = userEvent.setup();
    renderWithApollo(<ApiKeySettings />, [
      listed([KEY]),
      {
        request: { query: DeleteApiKeyDocument, variables: { keyId: KEY.id } },
        result: { errors: [{ message: 'API key not found' }] },
      },
    ]);

    await user.click(await screen.findByRole('button', { name: 'Revoke auto-cal' }));
    await screen.findByRole('alertdialog');
    await user.click(button('Revoke'));

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
    expect(screen.getByText('auto-cal')).toBeInTheDocument();
  });
});
