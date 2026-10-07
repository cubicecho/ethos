import { RATE_LIMIT_DEFAULTS, type RateLimitSettings } from '../core/defaults.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';

/**
 * Fixed-window counter, in process.
 *
 * Sign-in here is unauthenticated and passwordless, which makes
 * `requestMagicLink` an oracle for anyone who can reach the port: uncapped, one
 * prober can mint tokens for addresses at will or bury a real user in sign-in
 * mail. Per process is the right size for a single-container deployment —
 * anything larger belongs in the reverse proxy in front of it.
 */
export interface RateLimiter {
  /** Records an attempt; false once the key is over the limit for this window. */
  allow(key: string): boolean;
}

export function createRateLimiter(
  overrides: Partial<RateLimitSettings> = {},
  now: () => number = Date.now,
): RateLimiter {
  const { maxAttempts, windowMinutes } = { ...RATE_LIMIT_DEFAULTS, ...overrides };
  const windowMs = windowMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    allow(key: string): boolean {
      const at = now();
      // Sweep on write: the map holds only keys seen within one window, so a
      // long-running server does not accumulate every address ever probed.
      for (const [seen, window] of windows) {
        if (window.resetAt <= at) {
          windows.delete(seen);
        }
      }
      const window = windows.get(key);
      if (!window) {
        windows.set(key, { count: 1, resetAt: at + windowMs });
        return true;
      }
      window.count += 1;
      return window.count <= maxAttempts;
    },
  };
}
