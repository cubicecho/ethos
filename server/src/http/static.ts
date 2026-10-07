import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { HttpStatus } from '../core/wire.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export type StaticHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** The request's path with its percent-escapes decoded, or null when they are malformed. */
function decodedPathname(url: string | undefined): string | null {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://host').pathname);
  } catch {
    return null;
  }
}

/**
 * Serves the built web client next to /graphql, so one container is the whole
 * deployment and a magic link needs no second origin. Unknown paths fall back to
 * index.html — the SPA owns routing, including /auth/verify?token=… . Expo's
 * hashed bundles under /_expo get immutable caching; everything else revalidates.
 */
export function createStaticHandler(root: string): StaticHandler {
  const rootDir = resolve(root);
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(HttpStatus.MethodNotAllowed, { allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodedPathname(request.url);
    if (pathname === null) {
      response.writeHead(HttpStatus.BadRequest).end();
      return;
    }
    const requested = resolve(join(rootDir, normalize(pathname)));
    // normalize() alone does not stop "..%2f" walking out of the root once the
    // path has been decoded — compare the resolved path instead.
    if (requested !== rootDir && requested.startsWith(rootDir + sep) === false) {
      response.writeHead(HttpStatus.Forbidden).end();
      return;
    }
    const isFile = existsSync(requested) && statSync(requested).isDirectory() === false;
    const filePath = isFile ? requested : join(rootDir, 'index.html');
    if (isFile === false && existsSync(filePath) === false) {
      response.writeHead(HttpStatus.NotFound).end();
      return;
    }
    response.writeHead(HttpStatus.Ok, {
      'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'cache-control':
        pathname.startsWith('/_expo/') || pathname.startsWith('/assets/')
          ? `public, max-age=${HTTP_DEFAULTS.immutableCacheSeconds}, immutable`
          : 'no-cache',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  };
}
