import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS } from '@ethos/db/defaults';
import { AUTH_DEFAULTS, HTTP_DEFAULTS } from './defaults.ts';

/** What `version()` answers when the root package.json cannot be read. */
const UNKNOWN_VERSION = 'unknown';

/** What signs tokens when `JWT_SECRET` is unset. Preflight refuses it in production. */
export const DEV_SECRET = 'dev-secret-change-in-production';

/** The value `.env.example` ships. Public, so as good as no secret at all. */
export const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

/**
 * Why `secret` must not sign production tokens, or undefined when it may.
 *
 * Session tokens are signed with this and nothing else, so a secret that is
 * published or short enough to guess lets anyone mint a token for any account.
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

/** Whether this is a production instance, where the checks are strict and nothing is exposed. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** The Postgres connection string, or empty when unset. Preflight refuses empty. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? '';
}

/** How long boot waits for Postgres: `DB_CONNECT_TIMEOUT_MS`, or the default. */
export function dbConnectTimeoutMs(): number {
  return Number(process.env.DB_CONNECT_TIMEOUT_MS ?? DATABASE_DEFAULTS.connectTimeoutMs);
}

/** `JWT_SECRET` exactly as set, for preflight to judge. */
export function configuredJwtSecret(): string | undefined {
  return process.env.JWT_SECRET;
}

/** What signs tokens. Read at call time so a test — or a reload — sees the current environment. */
export function jwtSecret(): string {
  return configuredJwtSecret() ?? DEV_SECRET;
}

/**
 * The release this instance is running, from the root package.json.
 *
 * Read from the file, not `npm_package_version`: the image starts the server
 * with `node`, so npm never sets it.
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

/** The port to listen on: `PORT`, or the default. */
export function port(): number {
  return Number(process.env.PORT ?? HTTP_DEFAULTS.port);
}

/**
 * Where magic links point. In production the server serves the client itself,
 * so its own origin is the right default — but only for someone browsing from
 * this machine. Set APP_URL to the address users actually type; a link to
 * `localhost` is useless in an inbox.
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

/** Truthy env-var values: "1", "true", "yes" (case-insensitive). */
export function isFlagOn(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

/** Falsy env-var values: "0", "false", "no" (case-insensitive). */
function envDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'no'].includes((value ?? '').trim().toLowerCase());
}

/**
 * Whether signing in requires following a magic link at all.
 *
 * With `AUTH_MAGIC_LINK=false`, `requestMagicLink` hands back a live session for
 * whatever address it is given: there is no second factor and no link to follow.
 * That is a deliberate convenience for a self-hosted instance on a private
 * network. Anyone who can reach the port can then sign in as anyone, so it must
 * never be set on an instance exposed to the internet.
 */
export function isMagicLinkRequired(): boolean {
  return !envDisabled(process.env.AUTH_MAGIC_LINK);
}

/**
 * Whether the magic link is returned in the API response rather than only being
 * logged server-side.
 *
 * On outside production, or anywhere `EXPOSE_MAGIC_LINK` is set — which is what
 * a self-hosted instance with no mail provider wants, since the link has nowhere
 * else to go. Same warning as above: on a public deployment this lets anyone who
 * knows an address sign in as its owner.
 */
export function isMagicLinkExposed(): boolean {
  return isProduction() === false || isFlagOn(process.env.EXPOSE_MAGIC_LINK);
}
