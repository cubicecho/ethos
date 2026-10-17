import { createRequire } from 'node:module';
import { DATABASE_DEFAULTS } from '@ethos/db/defaults';
import { AUTH_DEFAULTS, type AuthSettings, HTTP_DEFAULTS } from './defaults.ts';

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
 * Where a browser reaches this server: the OIDC sign-in's start and callback live here. In
 * production the server serves the app, so it is `APP_URL`; in development the Expo dev server is
 * a second origin and this one is on its own port.
 *
 * @returns `SERVER_URL`, `APP_URL` in production, or this server's own localhost address.
 */
export function serverUrl(): string {
  const configured = process.env.SERVER_URL?.trim().replace(/\/+$/, '');
  if (configured) {
    return configured;
  }
  return isProduction() ? appUrl() : `http://localhost:${port()}`;
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
 * Whether /mcp serves the queries as MCP tools.
 *
 * Off unless asked for: an enabled endpoint lists the schema's queries to
 * anyone who can reach it, though every call still needs a session.
 *
 * @returns `MCP_ENABLED` as a flag, or `HTTP_DEFAULTS.mcp` when unset.
 */
export function mcpEnabled(): boolean {
  const value = process.env.MCP_ENABLED ?? '';
  return value.trim() === '' ? HTTP_DEFAULTS.mcp : isFlagOn(value);
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

/** The id the OIDC provider is registered under in better-auth, and so the last part of its callback path. */
export const OIDC_PROVIDER_ID = 'oidc';
/** The `OIDC_CLIENT_AUTH` values a provider can expect. */
export const OIDC_CLIENT_AUTH_METHODS = ['client_secret_basic', 'client_secret_post'] as const;

/** An OpenID Connect provider to sign in with: heautou, Keycloak, Authentik, … */
export interface OidcConfig {
  /** The issuer URL, no trailing slash. Its discovery document is `/.well-known/openid-configuration` under it. */
  issuer: string;
  clientId: string;
  /** Unset for a public client, which proves itself with PKCE alone. */
  clientSecret: string | undefined;
  /** How a confidential client sends its secret. The provider must expect the same. */
  clientAuth: AuthSettings['oidcClientAuth'];
  /** What the login page's button calls the provider. */
  name: string;
}

/**
 * Reads the OIDC provider set in the environment. preflight.ts refuses one of `OIDC_ISSUER` and
 * `OIDC_CLIENT_ID` without the other, and an `OIDC_CLIENT_AUTH` it does not know.
 *
 * @returns The provider when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are both set, otherwise null.
 */
export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim();
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) {
    return null;
  }
  const clientAuth = process.env.OIDC_CLIENT_AUTH?.trim();
  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() || undefined,
    clientAuth: clientAuth === 'client_secret_post' ? clientAuth : AUTH_DEFAULTS.oidcClientAuth,
    name: process.env.OIDC_NAME?.trim() || AUTH_DEFAULTS.oidcName,
  };
}

/**
 * Names the address to register with the OIDC provider as this client's redirect URI.
 *
 * @returns better-auth's callback for the provider, under `serverUrl()`.
 */
export function oidcRedirectUri(): string {
  return `${serverUrl()}/api/auth/callback/${OIDC_PROVIDER_ID}`;
}
