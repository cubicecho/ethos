# Ethos

A self-hostable habit tracker that is *just* habits.

A habit is a name, a colour and a cadence — every day, three times a week, ten
times a month — and a grid of the days you kept it. You tick the squares; Ethos
counts the streak. That is the whole product.

- **Habits** — a list of them, each with today's square and the streak so far.
- **A day at a time** — click a square once to keep the day, again to skip it,
  again to clear it. Nothing else to fill in.
- **Cadences** — daily, weekly or monthly, with a target count. A weekly habit is
  kept or missed by the week, so a quiet Tuesday is not a broken streak.
- **Skips** — a day you deliberately declined comes off what the period asked
  for instead of counting against you. Two of them per period, so the number
  still means something.
- **Streaks and rates** — counted over periods, and the period in progress never
  breaks one. The grid shows the tally the server counted, not a re-count.
- **An archive** — stop a habit without erasing having kept it.
- **Sign-in by magic link**, or no link at all on a private instance.

## Quickstart

One container plus Postgres. The app and the API are served from the same
origin, so there is no second host to configure.

Nothing to clone and nothing to build. Make a directory, and save this in it as
`docker-compose.yml`:

```yaml
name: ethos

services:
  ethos:
    image: vantreeseba/ethos:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      JWT_SECRET: ${JWT_SECRET:?generate one with `openssl rand -hex 32`}
      DATABASE_URL: postgres://ethos:${POSTGRES_PASSWORD:?set a database password}@postgres:5432/ethos
      # The address you actually reach Ethos at. Magic-link URLs are built from
      # it, so a link to localhost is useless in an inbox.
      APP_URL: ${APP_URL:-http://localhost:3006}
      NODE_ENV: production
    ports:
      - "${PORT:-3006}:3006"

  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ethos
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set a database password}
      POSTGRES_DB: ethos
    # No `ports`: the database is for the app beside it on the compose network,
    # and nothing else needs to reach it.
    volumes:
      - ethos_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ethos -d ethos"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  ethos_pgdata:
```

The same image is published to GitHub's registry as `ghcr.io/cubicecho/ethos`,
with the same tags, if you would rather pull from there.

Generate the two secrets it refuses to start without, then bring it up:

```bash
printf 'JWT_SECRET=%s\nPOSTGRES_PASSWORD=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > .env

docker compose up -d
```

Ethos is on <http://localhost:3006>. Migrations run at boot, so there is no
setup step. Sign in with any email address — Ethos ships no mail provider, so
the magic link goes to the log, and that is the delivery channel:

```bash
docker compose logs -f ethos
```

Keep that `.env`. `JWT_SECRET` signs sessions, so changing it signs everyone
out, and `POSTGRES_PASSWORD` is the database's own. Your data lives in the
`ethos_pgdata` volume, which survives `docker compose down`; upgrade with
`docker compose pull && docker compose up -d`.

Read [**Before you expose it**](#before-you-expose-it) before putting this on a
domain.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** Postgres connection string. There is no embedded fallback. |
| `JWT_SECRET` | — | **Required in production.** Signs session and magic-link tokens. `openssl rand -hex 32`. |
| `APP_URL` | `http://localhost:3006` | Public URL; magic-link URLs are built from it. |
| `PORT` | `3006` | Port the server listens on. |
| `AUTH_MAGIC_LINK` | `true` | Set to `false` to sign in with an address alone, no link. |
| `EXPOSE_MAGIC_LINK` | dev only | Return the magic link in the API response so the login page can show it. |

Ethos ships no mail provider. With magic links on, the link is written to the
server log, and that is the delivery channel — pipe the log somewhere you can
read, or run with `AUTH_MAGIC_LINK=false`.

## Before you expose it

Registration is **open**: any address that completes a sign-in gets an account.
That is the right default for an instance only you can reach, and the wrong one
for an instance on the public internet. Before putting Ethos on a domain:

- **Put it behind something.** A reverse proxy with TLS, and — if the instance is
  yours alone — an allowlist, VPN, or auth in front of it. Ethos rate-limits
  sign-in requests per address in process; per-IP limiting is the proxy's job,
  because the proxy is the only thing that reliably knows the client's address.
- **Never set `AUTH_MAGIC_LINK=false` on a reachable instance.** It makes an email
  address the entire credential: anyone who can load the login page can sign in
  as anyone.
- **Never set `EXPOSE_MAGIC_LINK=true` on a reachable instance.** It hands the
  sign-in token to whoever asked for it, which is the same thing by another route.
- **Set a real `JWT_SECRET`** and keep it. Changing it signs everyone out; leaking
  it lets anyone mint a session. The server refuses to boot in production while
  it is unset or still the default.

## Development

```bash
git clone https://github.com/cubicecho/ethos.git
cd ethos

cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env

npm install
npm run db:up          # Postgres in Docker, and it prints the DATABASE_URL to use
npm run db:migrate
npm run codegen
npm run dev            # API on 3006, app on http://localhost:3000
```

`npm run check` runs codegen, Biome and `tsc --noEmit` across all three
workspaces; `npm test` runs the suite against an in-memory Postgres. See
[AGENTS.md](AGENTS.md) for how the pieces fit together.

### When the Docker daemon is another machine

`docker context ls` showing a remote endpoint (`ssh://docker.lan`, `tcp://…`)
means the database container runs over there. `npm run db:up` handles the half
of that it can: it publishes Postgres on `0.0.0.0` rather than the daemon host's
own loopback, waits for the healthcheck, and prints the connection string to
put in `.env`:

```
Docker daemon is docker.lan, not this machine — publishing Postgres on 0.0.0.0:5438 so you can reach it.
[db-up] .env points DATABASE_URL at 127.0.0.1, but the database is on docker.lan. Set:
      DATABASE_URL=postgres://ethos:ethos@docker.lan:5438/ethos
```

Do that on a network you trust — the dev database has a throwaway password and
no TLS. Everything else runs here: the API on 3006, the app on 3000, both
talking to that Postgres. If the server still says `Cannot reach Postgres`, the
hostname in `DATABASE_URL` is the thing to check first.

### Building the image

The repo ships its own `docker-compose.yml`, which builds the image rather than
pulling it and publishes Postgres on `127.0.0.1:5438` so you can point your own
tooling at it:

```bash
export JWT_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

## License

[MIT](LICENSE) © Benjamin Van Treese
