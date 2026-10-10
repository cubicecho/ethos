import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS } from '@ethos/db/defaults';
import { AUTH_DEFAULTS, HTTP_DEFAULTS } from './defaults.ts';

/** What `version()` answers when the root package.json cannot be read. */
const UNKNOWN_VERSION = 'unknown';

/** What signs sessions when `BETTER_AUTH_SECRET` is unset. Preflight refuses it in production. */
export const DEV_SECRET = 'dev-secret-change-in-production';

/** The value `.env.example` ships. Public, so as good as no secret at all. */
export const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

/**
 * Why `secret` must not sign production tokens, or undefined when it may.
 *
 * better-auth signs with this and nothing else, so a secret that is published
 * or short enough to guess lets anyone forge what it signs.
 *
 * @param secret - `BETTER_AUTH_SECRET` as set.
 * @returns The reason, as the end of a sentence ("is not set").
 */
export function describeWeakSecret(secret: string | undefined): string | undefined {
  if (secret === undefined || secret === '') {
    return 'is not set';
  }
  if (secret === DEV_SECRET || secret === PLACEHOLDER_SECRET) {
    return 'is a published default';
  }
  if (secret.length < AUTH_DEFAULTS.minSecretLength) {
    return `is shorter than ${AUTH_DEFAULTS.minSecretLength} characters`;
  }
  return undefined;
}

/**
 * Whether this is a production instance, where the checks are strict and nothing is exposed.
 *
 * @returns true when `NODE_ENV` is `production`.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * The Postgres connection string, or empty when unset. Preflight refuses empty.
 *
 * @returns `DATABASE_URL`, or an empty string.
 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? '';
}

/**
 * How long boot waits for Postgres: `DB_CONNECT_TIMEOUT_MS`, or the default.
 *
 * @returns The wait, in milliseconds.
 */
export function dbConnectTimeoutMs(): number {
  return Number(process.env.DB_CONNECT_TIMEOUT_MS ?? DATABASE_DEFAULTS.connectTimeoutMs);
}

/**
 * `BETTER_AUTH_SECRET` exactly as set, for preflight to judge.
 *
 * @returns The secret, or undefined when unset.
 */
export function configuredAuthSecret(): string | undefined {
  return process.env.BETTER_AUTH_SECRET;
}

/**
 * What better-auth signs with. Read at call time so a test — or a reload — sees the current environment.
 *
 * @returns `BETTER_AUTH_SECRET`, or the development secret when unset.
 */
export function authSecret(): string {
  return configuredAuthSecret() || DEV_SECRET;
}

/**
 * The release this instance is running, from the root package.json.
 *
 * Read from the file, not `npm_package_version`: the image starts the server
 * with `node`, so npm never sets it.
 *
 * @returns The version, or the unknown-version placeholder when the manifest cannot be read.
 */
export function version(): string {
  try {
    const manifest: unknown = createRequire(import.meta.url)('../../../package.json');
    const isNamed = typeof manifest === 'object' && manifest !== null && 'version' in manifest;
    return isNamed && typeof manifest.version === 'string' ? manifest.version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/**
 * The port to listen on: `PORT`, or the default.
 *
 * @returns The port number.
 */
export function port(): number {
  return Number(process.env.PORT ?? HTTP_DEFAULTS.port);
}

/**
 * Where sign-in links point. In production the server serves the client itself,
 * so its own origin is the right default — but only for someone browsing from
 * this machine. Set APP_URL to the address users actually type; a link to
 * `localhost` is useless in an inbox.
 *
 * @returns `APP_URL`, or this server's own localhost address.
 */
export function appUrl(): string {
  return process.env.APP_URL ?? `http://localhost:${port()}`;
}

/**
 * The origins a browser may call the API from, or `true` for any.
 *
 * Production serves the web client itself, so the only origin with business
 * here is `APP_URL`. Development allows any: the Expo dev server is a second
 * origin, and it is opened by whatever hostname the laptop has on the network.
 *
 * @returns The list of origins, or `true` to allow every one.
 */
export function allowedOrigins(): string[] | true {
  return isProduction() ? [appUrl()] : true;
}

/**
 * How far to believe `X-Forwarded-For`, from `TRUST_PROXY`.
 *
 * Unset or `false` believes only the socket, which is right with no proxy in
 * front and wrong behind one: every client then shares the proxy's address and
 * one sign-in budget. A number is how many proxies sit in front; anything else
 * is passed to Express as written (`loopback`, a subnet).
 *
 * @returns false, a hop count, or a value Express's `trust proxy` accepts.
 */
export function trustProxy(): boolean | number | string {
  const value = (process.env.TRUST_PROXY ?? '').trim();
  if (value === '') {
    return HTTP_DEFAULTS.trustProxy;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  if (envDisabled(value)) {
    return false;
  }
  return isFlagOn(value) ? true : value;
}

/**
 * Truthy env-var values: "1", "true", "yes" (case-insensitive).
 *
 * @param value - The raw env value.
 * @returns false when unset, and for any other value.
 */
export function isFlagOn(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

/**
 * Falsy env-var values: "0", "false", "no" (case-insensitive).
 *
 * @param value - The raw env value.
 * @returns false when unset, and for any other value.
 */
function envDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'no'].includes((value ?? '').trim().toLowerCase());
}

/**
 * Whether typing an email address signs in, with no link to follow.
 *
 * The network is then the credential: anyone who can reach the port can sign in
 * as anyone. On only where nothing hostile can reach it, which preflight checks
 * against `APP_URL`.
 *
 * @returns `SECURE_LOCAL_NET` as a flag, or `AUTH_DEFAULTS.secureLocalNet` when unset.
 */
export function secureLocalNet(): boolean {
  const value = process.env.SECURE_LOCAL_NET ?? '';
  return value.trim() === '' ? AUTH_DEFAULTS.secureLocalNet : isFlagOn(value);
}

/**
 * Whether a public `APP_URL` is accepted alongside `SECURE_LOCAL_NET`.
 *
 * @returns `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC` as a flag, off when unset.
 */
export function allowsPublicLocalNet(): boolean {
  return isFlagOn(process.env.I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC);
}

/**
 * Where email is sent through.
 *
 * @returns `SMTP_URL`, or an empty string when unset.
 */
export function smtpUrl(): string {
  return process.env.SMTP_URL ?? '';
}

/**
 * The address sign-in email comes from.
 *
 * @returns `SMTP_FROM`, or `ethos@` the host of `APP_URL`.
 */
export function smtpFrom(): string {
  return process.env.SMTP_FROM || `ethos@${new URL(appUrl()).hostname}`;
}

/**
 * Whether sign-in links can be emailed.
 *
 * @returns true when `SMTP_URL` is set.
 */
export function smtpConfigured(): boolean {
  return smtpUrl() !== '';
}
