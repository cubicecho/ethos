import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedOrigins, DEV_SECRET, describeWeakSecret, PLACEHOLDER_SECRET } from '../../core/config.ts';
import { AUTH_DEFAULTS } from '../../core/defaults.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('describeWeakSecret', () => {
  it.each([undefined, ''])('refuses a secret that is not set (%j)', (secret) => {
    expect(describeWeakSecret(secret)).toBe('is not set');
  });

  it.each([DEV_SECRET, PLACEHOLDER_SECRET])('refuses the published default %s', (secret) => {
    expect(describeWeakSecret(secret)).toBe('is a published default');
  });

  it('refuses a secret one character short', () => {
    expect(describeWeakSecret('x'.repeat(AUTH_DEFAULTS.minSecretLength - 1))).toContain('shorter than');
  });

  it('accepts a secret of the minimum length', () => {
    expect(describeWeakSecret('x'.repeat(AUTH_DEFAULTS.minSecretLength))).toBeUndefined();
  });
});

describe('allowedOrigins', () => {
  it('is APP_URL alone in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://ethos.example.com');
    expect(allowedOrigins()).toEqual(['https://ethos.example.com']);
  });

  it('is any origin in development, where the Expo dev server is a second one', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(allowedOrigins()).toBe(true);
  });
});
