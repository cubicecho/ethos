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
- **Sign-in by emailed link**, or by address alone on a private network.

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
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?generate one with `openssl rand -hex 32`}
      DATABASE_URL: postgres://ethos:${POSTGRES_PASSWORD:?set a database password}@postgres:5432/ethos
      # The address you actually reach Ethos at. Sign-in links are built from
      # it, so a link to localhost is useless in an inbox.
      APP_URL: ${APP_URL:-http://localhost:3000}
      # How people sign in. Set one: a relay to email links through, or
      # SECURE_LOCAL_NET on a network you trust.
      SMTP_URL: ${SMTP_URL:-}
      SECURE_LOCAL_NET: ${SECURE_LOCAL_NET:-false}
      NODE_ENV: production
    ports:
      - "${PORT:-3000}:3000"

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
printf 'BETTER_AUTH_SECRET=%s\nPOSTGRES_PASSWORD=%s\nSECURE_LOCAL_NET=true\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > .env

docker compose up -d
```

Ethos is on <http://localhost:3000>. Migrations run at boot, so there is no
setup step. Sign in with any email address: `SECURE_LOCAL_NET=true` makes the
address the whole credential, which is right on your own machine and wrong
anywhere else. To email a one-time link instead, drop that line and set
`SMTP_URL` to a relay:

```bash
SMTP_URL=smtps://user:pass@smtp.example.com:465
```

Keep that `.env`. Changing `BETTER_AUTH_SECRET` signs everyone out, and `POSTGRES_PASSWORD` is the database's own. Your data lives in the
`ethos_pgdata` volume, which survives `docker compose down`; upgrade with
`docker compose pull && docker compose up -d`.

Read [**Before you expose it**](#before-you-expose-it) before putting this on a
domain.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** Postgres connection string. There is no embedded fallback. |
| `BETTER_AUTH_SECRET` | — | **Required in production.** What better-auth signs with. `openssl rand -hex 32`. |
| `APP_URL` | `http://localhost:3000` | Public URL; sign-in links are built from it, and in production it is the only origin allowed to call the API. |
| `PORT` | `3000` | Port the server listens on. |
| `TRUST_PROXY` | `false` | How many reverse proxies are in front (`1` behind one). Decides whose address sign-in is throttled by. |
| `DB_CONNECT_TIMEOUT_MS` | `60000` | How long boot waits for Postgres to start answering. |
| `SMTP_URL` | — | An SMTP relay to email sign-in links through, e.g. `smtps://user:pass@smtp.example.com:465`. |
| `SMTP_FROM` | `ethos@<APP_URL host>` | The address those emails come from. |
| `SECURE_LOCAL_NET` | `false` | Sign in with an address alone: no link, no mail. For a private network only. |
| `MCP_ENABLED` | `false` | Serve the API's queries as read-only [MCP](https://modelcontextprotocol.io) tools at `/mcp`. |

Set one of `SMTP_URL` and `SECURE_LOCAL_NET`. With neither, the server starts,
says so in its log, and nobody can sign in. A sign-in link works once, lasts 15
minutes, and is never written to the log or returned by the API. Sessions last
30 days and are rows in the database, so signing out ends one for good.

## Before you expose it

Registration is **open**: any address that completes a sign-in gets an account.
That is the right default for an instance only you can reach, and the wrong one
for an instance on the public internet. Before putting Ethos on a domain:

- **Put it behind something.** A reverse proxy with TLS, and — if the instance is
  yours alone — an allowlist, VPN, or auth in front of it. Ethos rate-limits
  sign-in per email address and per client IP, in process. Behind a proxy, set
  `TRUST_PROXY=1` so the client's address is the visitor's and not the proxy's;
  without it every visitor shares one sign-in budget.
- **Never set `SECURE_LOCAL_NET=true` on a reachable instance.** It makes an email
  address the entire credential: anyone who can load the login page can sign in
  as anyone. The server refuses to start with it when `APP_URL` names a public
  host, but an instance reached through a proxy on a private name is yours to judge.
- **Set a real `BETTER_AUTH_SECRET`** and keep it. Changing it signs everyone
  out. The server refuses to boot in production while it is unset, a published
  default, or shorter than 32 characters.

## Development

```bash
git clone https://github.com/cubicecho/ethos.git
cd ethos

cp .env.example .env
sed -i "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=$(openssl rand -hex 32)/" .env
echo SECURE_LOCAL_NET=true >> .env   # sign in with an address alone, on your own machine

npm install
npm run db:up          # Postgres in Docker, and it prints the DATABASE_URL to use
npm run db:migrate
npm run codegen
npm run dev            # API on 3000, app on http://localhost:8081
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
no TLS. Everything else runs here: the API on 3000, the app on 8081, both
talking to that Postgres. If the server still says `Cannot reach Postgres`, the
hostname in `DATABASE_URL` is the thing to check first.

### Building the image

The repo ships its own `docker-compose.yml`, which builds the image rather than
pulling it and publishes Postgres on `127.0.0.1:5438` so you can point your own
tooling at it:

```bash
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export SECURE_LOCAL_NET=true
docker compose up --build
```

## License

[MIT](LICENSE) © Benjamin Van Treese
