// Every number an operator or a maintainer might want to change, in one place.
// This file imports nothing, computes nothing and reads no environment.

export interface HttpSettings {
  /** The port the server listens on when `PORT` is unset. */
  port: number;
  /** How long a browser may keep a hashed bundle without asking again. */
  immutableCacheSeconds: number;
  /** How long shutdown lets requests in flight finish before closing their sockets. */
  drainSeconds: number;
  /** How long shutdown may take in all before the process exits anyway. */
  shutdownDeadlineSeconds: number;
}

export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  port: 3006,
  immutableCacheSeconds: 31_536_000,
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
});

export interface RateLimitSettings {
  /** Attempts one key may make inside a window. */
  maxAttempts: number;
  /** How long a window lasts. */
  windowMinutes: number;
}

export const RATE_LIMIT_DEFAULTS: Readonly<RateLimitSettings> = Object.freeze({
  maxAttempts: 5,
  windowMinutes: 15,
});

export interface AuthSettings {
  /** How long a session token is good for. Long: there is no refresh flow. */
  sessionTtlDays: number;
  /** How long a sign-in link is good for. Short: it travels by mail. */
  magicLinkTtlMinutes: number;
  /** The shortest `JWT_SECRET` production accepts. `openssl rand -hex 32` gives twice this. */
  minSecretLength: number;
}

export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  sessionTtlDays: 30,
  magicLinkTtlMinutes: 15,
  minSecretLength: 32,
});

export interface HabitSettings {
  /**
   * How many days of one period may be declined.
   *
   * A skip comes off what the period asked for, which is why it has to be
   * capped: a habit that can be skipped without limit can be skipped down to
   * owing nothing, and reported as kept.
   */
  maxSkipsPerPeriod: number;
  /** How many periods `history` returns when the caller names no number. */
  historyPeriods: number;
  /** The most periods `history` returns, whatever the caller asks for. */
  maxHistoryPeriods: number;
}

export const HABIT_DEFAULTS: Readonly<HabitSettings> = Object.freeze({
  maxSkipsPerPeriod: 2,
  historyPeriods: 12,
  maxHistoryPeriods: 52,
});
