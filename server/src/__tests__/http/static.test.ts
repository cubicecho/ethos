import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from '../../http/static.ts';

// A real directory rather than a mocked fs: the guard's whole job is to compare
// a resolved path against a real root, and a mock would be checking the mock.
let root: string;
let outside: string;
let server: Server;

const INDEX = '<!doctype html><title>Ethos</title>';
const SECRET = 'JWT_SECRET=hunter2';

beforeAll(() => {
  outside = mkdtempSync(join(tmpdir(), 'ethos-static-'));
  root = join(outside, 'web');
  mkdirSync(join(root, '_expo'), { recursive: true });
  writeFileSync(join(root, 'index.html'), INDEX);
  writeFileSync(join(root, 'app.css'), 'body{}');
  writeFileSync(join(root, '_expo', 'bundle.js'), 'console.log(1)');
  // What a traversal is reaching for: a sibling of the served root.
  writeFileSync(join(outside, 'secret.env'), SECRET);
  mkdirSync(join(outside, 'web-secrets'), { recursive: true });
  writeFileSync(join(outside, 'web-secrets', 'x.txt'), SECRET);
  server = createServer(createStaticHandler(root));
  return new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
});

afterAll(() => {
  server.close();
  rmSync(outside, { recursive: true, force: true });
});

/**
 * Ask the handler for a path and wait for the whole answer.
 *
 * Through a real server rather than a recorder standing in for the response: the
 * success path ends in `createReadStream().pipe(res)`, and the body is half of what
 * is asserted. `request` sends the path as written, which a traversal test needs —
 * `fetch` would resolve the `..` away before anything left the test.
 */
function call(url: string, method = 'GET'): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((settle, fail) => {
    const outgoing = request({ host: '127.0.0.1', port, path: url, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        settle({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }),
      );
    });
    outgoing.on('error', fail);
    outgoing.end();
  });
}

describe('createStaticHandler staying inside the root', () => {
  // Every one of these is clamped before `static.ts`'s own guard is consulted:
  // `new URL()` resolves `..` segments away, and `normalize()` drops any that
  // survive percent-decoding, because a pathname always starts at `/` and there
  // is nothing above it. The guard is the second line, kept for the day one of
  // those two stops being true. What is asserted here is the property that
  // matters either way — nothing outside the built client is ever served.
  const escapes = [
    '/../secret.env',
    '/web/../../secret.env',
    // `..%2f` only becomes a path segment after decoding, which is why the
    // guard compares resolved paths rather than trusting normalize() alone.
    '/..%2fsecret.env',
    '/%2e%2e%2fsecret.env',
    '/x/..%2f..%2fsecret.env',
    // Would defeat a `startsWith(rootDir)` guard written without the separator.
    '/../web-secrets/x.txt',
    // One decode leaves a literal `%2e%2e%2fsecret.env`, a name no file has.
    '/%252e%252e%252fsecret.env',
  ];

  it.each(escapes)('does not serve anything above the root for %s', async (url) => {
    const res = await call(url);
    expect(res.body).not.toContain(SECRET);
    // Indistinguishable from any other unknown path: the SPA, which is the
    // right answer — a 403 here would confirm that the file exists.
    expect(res.body).toBe(INDEX);
  });

  it('answers 400 rather than throwing on an undecodable path', async () => {
    expect((await call('/%E0%A4%A')).status).toBe(400);
  });
});

describe('createStaticHandler serving the built client', () => {
  it('serves a file that exists, with its body and its type', async () => {
    const res = await call('/app.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.body).toBe('body{}');
  });

  it('hands an unknown path to the SPA, which owns routing', async () => {
    // /auth/verify?token=… is a real route with no file behind it.
    const res = await call('/auth/verify?token=abc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.body).toBe(INDEX);
  });

  it('serves the index for the root itself rather than listing a directory', async () => {
    expect((await call('/')).body).toBe(INDEX);
  });

  it('caches hashed bundles forever and everything else not at all', async () => {
    expect((await call('/_expo/bundle.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await call('/app.css')).headers['cache-control']).toBe('no-cache');
    // The URL decides the caching, not the file that ends up being sent: an
    // immutable fallback-to-index would pin a stale app in every browser.
    expect((await call('/habits/abc')).headers['cache-control']).toBe('no-cache');
  });

  it('answers a HEAD with the headers and no body', async () => {
    const res = await call('/app.css', 'HEAD');
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });

  it('refuses a method it does not serve, and says which it does', async () => {
    const res = await call('/app.css', 'POST');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });
});
