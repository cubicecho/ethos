// Every number an operator or a maintainer might want to change about the
// connection, in one place. This file imports nothing and reads no environment.

export interface DatabaseSettings {
  /** How long boot waits for Postgres to answer before giving up. */
  connectTimeoutMs: number;
  /** The pause after the first failed attempt. */
  firstRetryDelayMs: number;
  /** The longest pause between attempts, however many have failed. */
  maxRetryDelayMs: number;
  /** What each pause is multiplied by to get the next. */
  retryBackoffFactor: number;
  /** How long shutdown lets running queries finish before closing on them. */
  closeTimeoutSeconds: number;
}

export const DATABASE_DEFAULTS: Readonly<DatabaseSettings> = Object.freeze({
  connectTimeoutMs: 60_000,
  firstRetryDelayMs: 500,
  maxRetryDelayMs: 5_000,
  retryBackoffFactor: 2,
  closeTimeoutSeconds: 5,
});
