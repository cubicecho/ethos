// Environment checks that must run before anything opens a connection or signs a
// token. Imported for its side effects as the very first import of index.ts, so
// a misconfigured instance fails with a sentence rather than a stack trace.

import { isPrivateHost } from '@ethos/db/ssl';
import {
  allowsPublicLocalNet,
  appUrl,
  configuredAuthSecret,
  databaseUrl,
  describeWeakSecret,
  isProduction,
  OIDC_CLIENT_AUTH_METHODS,
  secureLocalNet,
} from './config.ts';

/**
 * Reports a configuration fault and exits with status 1.
 *
 * @param message - What is wrong, as a sentence.
 */
function fatal(message: string): never {
  console.error(`[preflight] ${message}`);
  process.exit(1);
}

if (databaseUrl() === '') {
  fatal('DATABASE_URL is required. Copy .env.example to .env, then run `npm run db:up` for a local Postgres.');
}

if (isProduction()) {
  const weakness = describeWeakSecret(configuredAuthSecret());
  if (weakness !== undefined) {
    fatal(`BETTER_AUTH_SECRET ${weakness}. Set a strong random value: generate one with \`openssl rand -hex 32\`.`);
  }
}

if (secureLocalNet()) {
  const hostname = new URL(appUrl()).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isExposed = isPrivateHost(hostname) === false && allowsPublicLocalNet() === false;
  // With SECURE_LOCAL_NET, typing any email signs in as that account.
  if (isExposed) {
    fatal(
      `SECURE_LOCAL_NET is on but APP_URL (${appUrl()}) is not a private address. Turn it off, or set I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true if nothing hostile can reach this port.`,
    );
  }
}

// Half an OIDC setup leaves the login page without its button and no clue why,
// and a typo in the issuer would only show up at the first sign-in.
const oidcIssuer = process.env.OIDC_ISSUER?.trim() ?? '';
const oidcClientId = process.env.OIDC_CLIENT_ID?.trim() ?? '';
if ((oidcIssuer === '') !== (oidcClientId === '')) {
  fatal('OIDC_ISSUER and OIDC_CLIENT_ID go together: set both to sign in with an OIDC provider, or neither.');
}
const isIssuerUrl = URL.canParse(oidcIssuer);
if (oidcIssuer !== '' && isIssuerUrl === false) {
  fatal(`OIDC_ISSUER is not a URL: ${oidcIssuer}`);
}
const oidcClientAuth = process.env.OIDC_CLIENT_AUTH?.trim() ?? '';
const isKnownClientAuth = (OIDC_CLIENT_AUTH_METHODS as readonly string[]).includes(oidcClientAuth);
if (oidcClientAuth !== '' && isKnownClientAuth === false) {
  fatal(`OIDC_CLIENT_AUTH must be one of ${OIDC_CLIENT_AUTH_METHODS.join(', ')}.`);
}
