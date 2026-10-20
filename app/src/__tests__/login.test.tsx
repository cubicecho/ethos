import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginScreen from '../../app/login';
import { renderWithApollo } from '../components/domain/__tests__/helpers';
import { AuthConfigDocument, SsoSetupDocument } from '../lib/graphql';

// The screen lives under app/app, which Expo Router reads as routes, so its test sits here.

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

const SSO = { __typename: 'SsoProvider', name: 'heautou', signInUrl: 'http://ethos.test/sso/start' } as const;

/**
 * The two queries the login screen sends on mount, answered with `authConfig`.
 *
 * @param authConfig - Which sign-in methods the instance offers.
 * @returns The mocks for `renderWithApollo`.
 */
function mocksFor(authConfig: { secureLocalNet: boolean; magicLink: boolean; sso: typeof SSO | null }) {
  return [
    {
      request: { query: AuthConfigDocument },
      result: { data: { authConfig: { __typename: 'AuthConfig', ...authConfig } } },
    },
    {
      request: { query: SsoSetupDocument },
      result: {
        data: {
          ssoSetup: {
            __typename: 'SsoSetup',
            source: authConfig.sso ? 'PAIRED' : 'NONE',
            issuer: null,
            name: null,
            canPair: false,
            redirectUri: 'http://ethos.test/sso/callback',
          },
        },
      },
    },
  ];
}

describe('LoginScreen', () => {
  it('offers the email form when the instance can send links', async () => {
    renderWithApollo(<LoginScreen />, mocksFor({ secureLocalNet: false, magicLink: true, sso: null }));
    expect(await screen.findByRole('button', { name: 'Send sign-in link' })).toBeTruthy();
  });

  it('offers the email form under SECURE_LOCAL_NET with no mail', async () => {
    renderWithApollo(<LoginScreen />, mocksFor({ secureLocalNet: true, magicLink: false, sso: null }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('hides the email form when only a provider signs in', async () => {
    renderWithApollo(<LoginScreen />, mocksFor({ secureLocalNet: false, magicLink: false, sso: SSO }));
    expect(await screen.findByText('Sign in with heautou')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByText('or sign in by email')).toBeNull();
  });

  it('says sign-in is not set up, with no form, when nothing signs in', async () => {
    renderWithApollo(<LoginScreen />, mocksFor({ secureLocalNet: false, magicLink: false, sso: null }));
    expect(await screen.findByText('Sign-in is not set up')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});
