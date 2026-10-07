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
  /**
   * Whether `X-Forwarded-For` names the client: false, a hop count, or what
   * Express's `trust proxy` accepts. False believes only the socket.
   */
  trustProxy: boolean | number | string;
  /** The largest request body /graphql reads, as `bytes` writes sizes. Larger is a 413. */
  bodyLimit: string;
}

export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  port: 3006,
  immutableCacheSeconds: 31_536_000,
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
  trustProxy: false,
  bodyLimit: '1mb',
});

export interface RateLimitSettings {
  /** Attempts one key may make inside a window. */
  maxAttempts: number;
  /** How long a window lasts. */
  windowMinutes: number;
  /** How many keys the limiter holds before it drops the ones that have gone quiet. */
  sweepAtKeys: number;
}

export const RATE_LIMIT_DEFAULTS: Readonly<RateLimitSettings> = Object.freeze({
  maxAttempts: 5,
  windowMinutes: 15,
  sweepAtKeys: 10_000,
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
  /** The longest name a habit may have. */
  maxNameLength: number;
  /** The longest note, on a habit or on one of its days. */
  maxNoteLength: number;
}

export const HABIT_DEFAULTS: Readonly<HabitSettings> = Object.freeze({
  maxSkipsPerPeriod: 2,
  historyPeriods: 12,
  maxHistoryPeriods: 52,
  maxNameLength: 120,
  maxNoteLength: 2_000,
});

export interface OperationLimitSettings {
  /** Rows a list field returns when the query states no `limit`. */
  defaultPageSize: number;
  /** The largest `limit` a query may state. Larger is refused, not trimmed. */
  maxPageSize: number;
  /** How many levels of selection a query may nest. */
  maxDepth: number;
  /** How many aliases one operation may use. An alias is how one request asks for a field many times. */
  maxAliases: number;
  /** The most one operation may cost: roughly the fields it could return, lists priced by their `limit`. */
  maxCost: number;
  /** What a field costs when the schema states no price for it. */
  defaultFieldCost: number;
}

export const OPERATION_LIMIT_DEFAULTS: Readonly<OperationLimitSettings> = Object.freeze({
  defaultPageSize: 50,
  maxPageSize: 500,
  maxDepth: 8,
  maxAliases: 15,
  maxCost: 10_000,
  defaultFieldCost: 1,
});
