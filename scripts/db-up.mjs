/**
 * Brings up the dev Postgres — `npm run db:up`.
 *
 * A wrapper rather than a bare `docker compose up` because of the one thing
 * compose cannot know: whether the Docker daemon is this machine. With a remote
 * context (`docker context ls` → `ssh://docker.lan`) the container runs over
 * there, so two defaults that are right locally are wrong:
 *
 *   - publishing on `127.0.0.1` binds the *daemon host's* loopback, which
 *     nothing on your machine can reach;
 *   - `DATABASE_URL=…@127.0.0.1:5438` names your machine, where there is no
 *     Postgres.
 *
 * So the bind follows the daemon, and the host the connection string should use
 * is printed rather than guessed at — `.env` is yours, and a script that
 * rewrites it behind you is worse than one that tells you.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const COMPOSE_FILE = 'docker-compose.dev.yml';

/** The host the active Docker context points at, or null when it is this machine. */
function daemonHost() {
  const probe = spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
    encoding: 'utf8',
  });
  // No docker, no context, no opinion — fall through to the local defaults and
  // let `docker compose` itself be the one to complain.
  if (probe.status !== 0) return null;

  const endpoint = probe.stdout.trim();
  if (endpoint.startsWith('unix://') || endpoint.startsWith('npipe://')) return null;
  try {
    return new URL(endpoint).hostname || null;
  } catch {
    return null;
  }
}

/** The host `.env` tells the app to connect to, if it says anything at all. */
function configuredHost() {
  if (!existsSync('.env')) return null;
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((line) => line.trim().startsWith('DATABASE_URL='));
  if (!line) return null;
  try {
    return new URL(line.slice(line.indexOf('=') + 1).trim()).hostname;
  } catch {
    return null;
  }
}

const remote = daemonHost();
const port = process.env.POSTGRES_PORT ?? '5438';
// An explicit POSTGRES_BIND is the operator's decision and is left alone.
const bind = process.env.POSTGRES_BIND ?? (remote ? '0.0.0.0' : '127.0.0.1');
const host = remote ?? '127.0.0.1';

if (remote) {
  console.log(`Docker daemon is ${remote}, not this machine — publishing Postgres on ${bind}:${port} so you can reach it.`);
}

// `--wait` holds until the healthcheck passes, so `db:up && db:migrate` works as
// one breath rather than racing a Postgres that is still starting up.
const up = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait'], {
  stdio: 'inherit',
  env: { ...process.env, POSTGRES_BIND: bind, POSTGRES_PORT: port },
});
if (up.status !== 0) process.exit(up.status ?? 1);

const url = `postgres://ethos:ethos@${host}:${port}/ethos`;
const configured = configuredHost();
if (configured && configured !== host) {
  console.log('');
  console.log(`[db-up] .env points DATABASE_URL at ${configured}, but the database is on ${host}. Set:`);
  console.log(`      DATABASE_URL=${url}`);
} else if (!configured) {
  console.log('');
  console.log(`Postgres is up. Put this in .env:\n      DATABASE_URL=${url}`);
} else {
  console.log(`\nPostgres is up at ${host}:${port}.`);
}
