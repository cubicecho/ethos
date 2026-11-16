import type { Express } from 'express';
import type { AuthHost } from '../auth/auth-host.ts';
import { oidcApiAudience, serverUrl } from '../core/config.ts';
import type { Context } from '../core/context.ts';

// OAuth 2.0 Protected Resource Metadata (RFC 9728): how a client that holds no
// credential yet (a device app such as Home Assistant) learns which
// authorization server issues tokens for this API, and which audience to ask
// for. Heautou reads it too, under the `client_uri` pairing registered, to offer
// its admin Ethos's API. The authorization server is the provider in effect,
// read per request, so pairing one shows here without a restart.

/** The well-known path RFC 9728 names. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** What this API calls itself in its metadata. */
const RESOURCE_NAME = 'Ethos';

/** What the metadata document says. */
export interface ProtectedResourceMetadata {
  /** The API audience a token must be issued for. */
  resource: string;
  /** The provider's issuer, or none while there is no provider. */
  authorization_servers: string[];
  bearer_methods_supported: ['header'];
  resource_name: string;
}

/**
 * Builds the metadata as it stands now.
 *
 * @param host - Where the provider in effect is.
 * @returns The document.
 */
export function protectedResourceMetadata(host: AuthHost): ProtectedResourceMetadata {
  const oidc = host.oidc();
  return {
    resource: oidcApiAudience(),
    authorization_servers: oidc === null ? [] : [oidc.issuer],
    bearer_methods_supported: ['header'],
    resource_name: RESOURCE_NAME,
  };
}

/**
 * Serves the metadata at the well-known path, and at that path followed by the resource's own path
 * (`/.well-known/oauth-protected-resource/graphql`), which is where RFC 9728 §3.1 has a client look for a resource
 * that has a path.
 *
 * @param app - The Express app. Mount before the web client's fallback, which would answer both.
 * @param host - Where the provider in effect is.
 */
export function mountProtectedResource(app: Express, host: AuthHost): void {
  const paths = [PROTECTED_RESOURCE_PATH];
  const audience = oidcApiAudience();
  const resourcePath = URL.canParse(audience) ? new URL(audience).pathname.replace(/\/+$/, '') : '';
  if (resourcePath !== '') {
    paths.push(`${PROTECTED_RESOURCE_PATH}${resourcePath}`);
  }
  app.get(paths, (_request, response) => {
    response.json(protectedResourceMetadata(host));
  });
}

/**
 * Builds the `WWW-Authenticate` challenge for a request whose bearer was refused, while there is a provider to get a
 * good one from (RFC 6750 §3, RFC 9728 §5.1). GraphQL answers a refused credential with HTTP 200 and UNAUTHENTICATED
 * on the field, never 401, so the challenge rides on that 200.
 *
 * @param context - The request's context: its auth host, headers and caller.
 * @returns The header's value, or null when there is nothing to say.
 */
export function bearerChallenge({
  authHost,
  headers,
  userId,
}: Pick<Context, 'authHost' | 'headers' | 'userId'>): string | null {
  const hasBearer = headers.get('authorization')?.startsWith('Bearer ') ?? false;
  if (authHost.oidc() === null || userId !== null || hasBearer === false) {
    return null;
  }
  return `Bearer error="invalid_token", resource_metadata="${serverUrl()}${PROTECTED_RESOURCE_PATH}"`;
}
