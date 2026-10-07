import { describe, expect, it, vi } from 'vitest';
import { errorCode, waitForDatabase } from '../wait.ts';

// A database that fails a set number of times and then answers. No Postgres is
// needed to test waiting for one.

const FAST = { firstRetryDelayMs: 1, maxRetryDelayMs: 2, connectTimeoutMs: 1_000 };

const coded = (code: string) => Object.assign(new Error(code), { code });

function flaky(failures: unknown[]) {
  const execute = vi.fn(async () => {
    const failure = failures.shift();
    if (failure !== undefined) {
      throw failure;
    }
    return [];
  });
  return { execute };
}

describe('waitForDatabase', () => {
  it('resolves at once when Postgres answers', async () => {
    const db = flaky([]);
    await waitForDatabase(db, FAST, () => {});
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('retries while Postgres is still starting', async () => {
    const db = flaky([coded('ECONNREFUSED'), coded('57P03')]);
    const log = vi.fn();
    await waitForDatabase(db, FAST, log);
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('reads the code Drizzle wraps', async () => {
    const db = flaky([new Error('Failed query', { cause: coded('ECONNREFUSED') })]);
    await waitForDatabase(db, FAST, () => {});
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('does not wait on a failure that waiting will not cure', async () => {
    const wrongPassword = coded('28P01');
    const db = flaky([wrongPassword]);
    await expect(waitForDatabase(db, FAST, () => {})).rejects.toBe(wrongPassword);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('gives up with the last error once the time is up', async () => {
    const refused = coded('ECONNREFUSED');
    const db = flaky([refused, refused, refused]);
    await expect(waitForDatabase(db, { ...FAST, connectTimeoutMs: 0 }, () => {})).rejects.toBe(refused);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('errorCode', () => {
  it('is undefined for a thrown value that carries none', () => {
    expect(errorCode(new Error('plain'))).toBeUndefined();
    expect(errorCode('a string')).toBeUndefined();
  });
});
