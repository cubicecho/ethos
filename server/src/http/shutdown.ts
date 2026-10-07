import type { Server } from 'node:http';
import { HTTP_DEFAULTS, type HttpSettings } from '../core/defaults.ts';
import { MS_PER_SECOND } from '../core/wire.ts';

/** What an orchestrator, or Ctrl-C, sends to ask for a stop. */
const STOP_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/** Work to do around closing the listener. */
export interface ShutdownHooks {
  /** Runs first, while requests are still being served. */
  before?: () => Promise<void> | void;
  /** Runs once no request is in flight: the place to close the database. */
  after?: () => Promise<void> | void;
}

/**
 * Stops accepting connections and resolves once every request has finished.
 *
 * Idle keep-alive sockets are closed at once, since nothing is waiting on them.
 * A request still running after `drainSeconds` has its socket closed under it,
 * so one stuck client cannot hold the process open.
 */
export function drain(server: Server, drainSeconds: number): Promise<void> {
  return new Promise((resolve) => {
    const cutoff = setTimeout(() => server.closeAllConnections(), drainSeconds * MS_PER_SECOND);
    server.close(() => {
      clearTimeout(cutoff);
      resolve();
    });
    server.closeIdleConnections();
  });
}

/**
 * Makes SIGTERM and SIGINT a clean stop: drain, run the hooks, exit 0.
 *
 * Docker sends SIGTERM and then SIGKILL ten seconds later, so the whole stop is
 * held under `shutdownDeadlineSeconds`. A second signal exits at once, for the
 * person at the terminal who has stopped waiting.
 */
export function stopOnSignals(server: Server, hooks: ShutdownHooks = {}, overrides: Partial<HttpSettings> = {}): void {
  const { drainSeconds, shutdownDeadlineSeconds } = { ...HTTP_DEFAULTS, ...overrides };
  let isStopping = false;

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    if (isStopping) {
      process.exit(1);
    }
    isStopping = true;
    console.log(`[shutdown] ${signal} received. Finishing requests in flight.`);
    setTimeout(() => {
      console.error(`[shutdown] Not finished after ${shutdownDeadlineSeconds} s. Exiting anyway.`);
      process.exit(1);
    }, shutdownDeadlineSeconds * MS_PER_SECOND).unref();

    await hooks.before?.();
    await drain(server, drainSeconds);
    await hooks.after?.();
    console.log('[shutdown] Stopped.');
    process.exit(0);
  };

  for (const signal of STOP_SIGNALS) {
    process.on(signal, (received) => {
      stop(received).catch((error: unknown) => {
        console.error('[shutdown] Failed while stopping.', error);
        process.exit(1);
      });
    });
  }
}
