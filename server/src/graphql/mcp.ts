import type { IncomingHttpHeaders } from 'node:http';
import { createHttpHandler, type McpHttpHandler } from '@cubicecho/graphql-mcp';
import type { GraphQLSchema } from 'graphql';
import { version } from '../core/config.ts';
import type { ContextFactory } from './handler.ts';

// The same schema instance /graphql serves, projected as MCP tools. Every call
// runs in-process through the same resolvers, so the row scope and
// `requireAuth` an agent meets are the ones a browser does.

/** What an MCP client is told this server is called. */
export const MCP_NAME = 'ethos';

/**
 * Node's header bag as the `Headers` the context factory reads.
 *
 * @param raw - A request's headers, as node:http parsed them.
 * @returns The same headers, with a repeated one appended once per value.
 */
function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const one of value) {
        headers.append(name, one);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * Builds the /mcp handler: a tool for each query, and none for a mutation.
 *
 * Read-only on purpose. The mutations are sign-in and the writes that record a
 * day, and neither is something to hand an agent by default.
 *
 * @param schema - The schema /graphql serves.
 * @param contextFor - Builds a request's context, as it does for /graphql.
 * @returns The handler, for a route that has already parsed the JSON body.
 */
export function createMcpHandler(schema: GraphQLSchema, contextFor: ContextFactory): McpHttpHandler {
  return createHttpHandler({
    schema,
    name: MCP_NAME,
    version: version(),
    includeMutations: false,
    // Express's `ip` where there is one, since it honours TRUST_PROXY.
    contextFromRequest: (request) =>
      contextFor(
        toHeaders(request.headers),
        'ip' in request && typeof request.ip === 'string' ? request.ip : request.socket.remoteAddress,
      ),
  });
}
