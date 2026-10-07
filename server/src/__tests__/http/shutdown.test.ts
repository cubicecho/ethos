import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { drain } from '../../http/shutdown.ts';
import { portOf } from '../helpers.ts';

const SLOW_MS = 50;
const SHORT_DRAIN_SECONDS = 0.05;
const LONG_DRAIN_SECONDS = 5;

async function listening(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  const server = createServer(handler);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return server;
}

describe('drain', () => {
  it('lets a request in flight finish', async () => {
    const server = await listening((_request, response) => {
      setTimeout(() => response.end('done'), SLOW_MS);
    });
    const pending = fetch(`http://127.0.0.1:${portOf(server)}/`);
    // Wait for the request to arrive, so the drain starts with it in flight.
    await new Promise<void>((resolve) => server.once('request', () => resolve()));
    await drain(server, LONG_DRAIN_SECONDS);
    expect(await (await pending).text()).toBe('done');
    expect(server.listening).toBe(false);
  });

  it('closes on a request that outlasts the drain', async () => {
    const server = await listening(() => {
      // Never answers.
    });
    const pending = fetch(`http://127.0.0.1:${portOf(server)}/`);
    await new Promise<void>((resolve) => server.once('request', () => resolve()));
    await drain(server, SHORT_DRAIN_SECONDS);
    await expect(pending).rejects.toThrow();
    expect(server.listening).toBe(false);
  });
});
