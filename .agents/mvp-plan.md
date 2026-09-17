# Ethos — scaffold a self-hostable habit tracker at `apps/ethos`

## Context

`apps/ethos/` is empty. It should become **Ethos** — a standalone, self-hostable habit
tracker that is *just* habits: a name, a cadence, and the grid of days you kept it.

Habit tracking already exists inside `auto-cal`, tangled up with the calendar it was
built next to. Telos took the todo half of that codebase out into its own repo; Ethos is
the same move for the habit half. It sits alongside `philotes`, `auto-cal`, `telos`,
`eunomia`, `notes` and `personal-dashboard`, each of which is its own git repo under
`github.com/cubicecho` (there is no workspace root at `cubicecho/`, no root
`package.json`, and `cubicecho/` is not itself a repo).

**Follow the telos pattern.** Telos is the most recent and most complete expression of
the house shape — generated GraphQL, tenancy as configuration, one container for the
whole deployment — and a contributor who has read one repo should not have to relearn
anything to read the other. Where a concern is the same, copy telos file-for-file. What
is genuinely new here is the domain: periods, cadences and streaks.

**Decisions already made (do not revisit):**

| | |
| --- | --- |
| Name | **Ethos** — repo `cubicecho/ethos`, image `vantreeseba/ethos`, packages `@ethos/{app,server,db}` |
| Frontend | Expo Router (web target) + NativeWind + Apollo Client, as telos. **Not** cubeui — it needs Tailwind v4, NativeWind is v3 |
| Database | **Postgres only.** `DATABASE_URL` required; the server refuses to boot without it. PGlite appears only as a test fixture |
| Cadences | **Three: daily, weekly, monthly**, each with a target count. Calendar-aligned, not rolling windows |
| A day | A `YYYY-MM-DD` label the keeper wrote, never an instant. Nothing converts it in either direction |
| Skips | A skip comes off the period's target rather than counting as a miss, and is **capped at 2 per period** |
| Email | None. The magic link is logged to the server console and returned in the API response when exposure is enabled |
| Plan doc | `.agents/mvp-plan.md`, not the repo root — house rule |
| Commits | Conventional Commits. **No `Co-Authored-By` trailers** |
| Ports | **3006** server, **3007** Expo dev, Postgres on **5438** — telos owns 3001/3000/5435, eunomia 4000/5433 |

## Architecture

Three npm workspaces in one repo:

```
apps/ethos/
├── db/       @ethos/db      Drizzle schema + relations + migrations
├── server/   @ethos/server  Express 5 + Apollo Server 5, GraphQL
└── app/      @ethos/app     Expo Router web client
```

The load-bearing idea, inherited: **the GraphQL schema is generated from the Drizzle
schema** by `@vantreeseba/drizzle-graphql`'s `buildSchema()`. There are no hand-written
CRUD resolvers. Multi-tenancy is *configuration* (`scope` + `contextValues` handed to
`buildSchema`), not resolver wrappers — `scope` is ANDed into the SQL of every generated
read, and `contextValues` strips `userId` from every input and stamps it from the
request. Only what CRUD cannot express gets a hand-written resolver, and here that is
exactly two things: the derived fields a habit has (streak, history, the current period)
and the two mutations that record a day.

`@ethos/db` exports raw `.ts` through its `exports` map rather than compiling to
`dist/`, which removes the "rebuild db before codegen" footgun.

## Data model — `db/src/models/*.ts`

One file per table, barrel-exported from `db/src/schema.ts`, relations in
`db/src/relations.ts` via `defineRelations`. `uuid().primaryKey().defaultRandom()`,
`snake_case` columns, `camelCase` in Drizzle, `index()` on every FK.

- **`users`** — `id`, `email` (unique), `name`, `createdAt`, `updatedAt`. No password column; magic link is the only credential.
- **`habits`** — `id`, `userId`, `name`, `notes`, `color`, `period` (`'day' | 'week' | 'month'`), `targetCount`, `position`, `archivedAt`, `createdAt`, `updatedAt`.
- **`habitEntries`** — `id`, `userId`, `habitId` → habits (cascade), `day` (`date`, `mode: 'string'`), `status` (`'done' | 'skipped'`), `note`, `createdAt`, `updatedAt`.

Three constraints carry the invariants the application must not be the only thing
holding:

- `unique('uq_habit_entries_day').on(habitId, day)` — **one day is one row.** `markHabit`
  upserts onto this constraint rather than reading first and writing after, so a
  double-click, two open tabs and a retried request are the same tick.
- `ck_habits_target_positive` — `target_count > 0`.
- `ck_habits_daily_target` — a daily habit's target is 1. A day cannot be kept twice, and
  `target_count = 3, period = 'day'` stored is a streak nobody can reproduce.
- `ck_habits_period` — the three cadences, spelled out.

`day` is `date` with `mode: 'string'` on purpose: `mode: 'date'` would hand back a
`Date`, which is an instant, which is a timezone conversion waiting to happen. The
ceiling on a target — 7 a week, 28 a month — is *not* a database check, because it
depends on which month; see `server/src/cadence.ts`.

Every table carries `userId`, so every one of them uses the same one-line
`scopeByUserId`. The tradeoff — a caller could name someone else's `habitId` on insert,
since `scope` cannot reach a plain insert — is closed by the `onWrite` hooks below.

## Server — `server/src/`

Follow `apps/telos/server/src/` file-for-file where the concern is the same: `index.ts`,
`preflight.ts`, `preload-env.ts`, `config.ts`, `context.ts`, `static.ts`,
`rate-limit.ts`, `routes/graphql.ts` and `resolvers/auth.ts` are ports with the names
changed. What is new:

- **`periods.ts`** — where the boundaries are drawn. `assertDay`, `addDays`,
  `daysBetween`, `periodStart`/`periodEnd`/`periodLength`, `periodOf`, `periodBefore`,
  `recentPeriods`. Weeks start Monday (ISO). **Every calculation goes through `Date.UTC`**
  — `new Date('2026-09-17')` is UTC midnight, which is the sixteenth for most of the
  Americas, so a local `Date` anywhere in this file is a day-off bug for half the world.
- **`streaks.ts`** — what a run of kept days is worth. Pure: no database, no clock.
  `effectiveTarget = max(0, target - skipped)`, `met`, `rate` clamped to 1,
  `tallyPeriod`, `streakOf`, `longestStreakOf`, and `MAX_SKIPS_PER_PERIOD = 2`. The three
  rules it exists to hold: a skip is not a miss; a streak counts periods, not days; the
  period in progress cannot break a streak.
- **`cadence.ts`** — what a period can be asked for. `maxTargetFor` (day 1, week 7, month
  **28** — February, because a cadence that works in August and fails in February breaks
  once a year for reasons nobody wrote down), `describeCadenceLimit`, and
  `assertTargetsFitPeriods`.
- **`loaders.ts`** — per-request DataLoaders for a habit's entries and a habit's cadence,
  so a list of habits asking for `streak` is two queries rather than 2N.
- **`tenancy.ts`** — `scope`, `contextValues`, `features`, shaped like telos'. Every table
  gets `scopeByUserId`; `users` scopes on `id`. `features` denies generated
  insert/update/delete on `users` (auth owns that lifecycle) and on `habitEntries` (the
  custom mutations own it, so the day key and the skip cap cannot be bypassed).
- **`resolvers/habits.ts`** — `extendSchema` adding `type HabitPeriod`, the four derived
  fields on `Habit` (`streak`, `longestStreak`, `history`, `current`, each taking the
  client's `today`), and `markHabit` / `clearHabit`.
- **`resolvers/write-guards.ts`** — the `onWrite` hooks, covering what `scope` structurally
  cannot: ownership of any FK a caller can state (`habitId`), and the cadence ceiling.

Errors follow the house vocabulary: `GraphQLError` with `extensions.code`;
`UNAUTHENTICATED` only for session expiry, `BAD_USER_INPUT` for a bad day, a bad magic
link or an impossible cadence, and **`NOT_FOUND` rather than `FORBIDDEN`** for a row the
caller may not see.

Two rules about the write guards that are the whole reason they exist:

1. **The cadence check is an `after` hook over the caller's rows, not a `before` hook over
   the arguments.** A write that changes only `period` — month to week, target left where
   it was — is exactly the one a check reading the arguments would wave through.
2. **The check is re-asserted as an invariant**, not evaluated on what the write returned.
   A GraphQL mutation returns only the columns the client selected, so a guard reading the
   returned row passes silently whenever the client did not ask for the column it needs.

## Client — `app/`

Expo Router web target, mirroring `apps/telos/app/`: `app.json`, `babel.config.js`
(module-resolver `@` → `./src`), `metro.config.js`, `tailwind.config.js`,
`postcss.config.js`, `components.json`, `codegen.ts`, `global.css`, `public/index.html`
with the pre-paint theme script. Write DOM elements and Tailwind classes, not React
Native primitives — `react-native` is imported only for `Platform`.

Routes (`app/app/`, which is *not* `app/src/`):

| Route | Contents |
| --- | --- |
| `_layout.tsx` | ApolloProvider (auth link + `onError` clearing the token on `UNAUTHENTICATED`) + Stack + `ErrorBoundary` |
| `login.tsx` | Email field → `requestMagicLink` |
| `auth/verify.tsx` | Fires `verifyMagicLink` once behind a `useRef` guard, stores the token, `router.replace`s in |
| `(app)/_layout.tsx` | `if (!isAuthenticated()) return <Redirect href="/login" />`, then the sidebar shell |
| `(app)/index.tsx` | **Today** — every active habit, its cadence, its streak, and today's square |
| `(app)/habits/[id].tsx` | One habit: its history, its grid, its numbers |
| `(app)/archive.tsx` | Archived habits, read-only |
| `(app)/settings/index.tsx` | Theme + account |

`src/lib/`: `auth.ts` (telos' four functions, key renamed `ethos_token`), `apollo.ts`,
`cache.ts`, `errors.ts`, `ids.ts`, `theme.ts`, `hotkeys.ts`, `readable-text-color.ts`,
`graphql.ts`, and the two domain modules:

- **`periods.ts` is a deliberate copy of `server/src/periods.ts`.** The grid draws the
  periods the streak is counted over, so if the two disagree the app shows a streak
  nobody can reproduce by counting squares. They are separate packages — the app is
  bundled by Metro and must not pull Drizzle into a browser — so the rule is kept by the
  files being twins and by the two `periods.test.ts` suites asserting the same
  boundaries. `today()` is the only local-clock read in the app; every formatter is
  pinned to UTC.
- **`cadence.ts`** mirrors `server/src/cadence.ts` so the form refuses an impossible
  target while it is still being typed. The server's copy is the one that decides.
- **`use-today.ts`** — the client's own day, re-checked on an interval and on `focus`,
  because a tab left open over midnight would otherwise keep yesterday's grid.

Components under `src/components/`:
- `ui/` — shadcn primitives copied in. No app logic.
- `layouts/sidebar.tsx` — Today, the habit list, the archive, settings.
- `domain/habit/` — `day-square`, `habit-grid`, `habit-row`, `habit-list-item`, `habit-overview`, `habit-form-dialog`, `types.ts`, and `use-mark-habit.ts` (the one hook every square's click goes through).
- `domain/settings/` — `theme-selector`.

Two client rules worth stating up front:

- **A square is told apart by shape as well as by colour** — filled, dashed outline, plain
  outline — because the fill is the habit's own colour and a reader who cannot tell two of
  them apart would have no way back. Today is *outlined* rather than filled, so "today"
  and "kept" are readable at once.
- **Nothing marks a day optimistically.** Every other write edits the cache before the
  request leaves; a tick does not, because what it changes is the streak, and answering
  that on the client means reimplementing `streaks.ts` in the browser and keeping the two
  in step. The controls disable while the mutation is in flight instead.

## Repo scaffolding

Root files, taking telos' versions as the base: `package.json` (workspaces, `overrides`),
`biome.json`, tsconfigs, `vitest.config.ts`, `Dockerfile` (two stages on
`node:24-alpine`; runtime runs TypeScript directly, **no `--preserve-symlinks`**),
`docker-compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`, `.releaserc.json`,
`.github/workflows/ci.yml`, `AGENTS.md`, `CLAUDE.md` (`Use AGENTS.md instead.`),
`README.md`, and this plan.

`vitest.config.ts` has two projects rather than telos' one: `node` (PGlite, covering
`db/**`, `server/**` and `app/src/lib/**/*.test.ts`) and `dom` (jsdom, covering
`app/**/*.test.tsx`). The client's period and cadence maths is pure and belongs in the
fast project.

## Order of work

1. Root scaffolding (`package.json`, `biome.json`, tsconfigs, `.gitignore`, `.env.example`).
2. `db/` — models, relations, `drizzle.config.ts`, `src/index.ts`, generate the initial migration.
3. `server/` — periods, streaks, cadence first (they are pure and everything else reads them), then tenancy, loaders, write guards, resolvers, auth, routes, static, index.
4. `app/` — Expo config, Apollo client, auth lib, `periods.ts`/`cadence.ts`, routes, then components inward-out.
5. Tests, then `Dockerfile` / `docker-compose.yml` / CI.
6. Docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.agents/mvp-plan.md`.
7. One initial commit, Conventional Commits style, no trailers. Creating `cubicecho/ethos` on GitHub is a separate step to ask about rather than assume.

## Verification

Tests (Vitest). Do **not** import `@ethos/db` from a test — it opens a real connection at
import. Build a throwaway in-memory Postgres per suite with `new PGlite('memory://')` and
`pushSchema`.

- `tenancy.test.ts` — every table has a `scope` entry, and every non-`users` table stamps `userId` from the context. Ported from telos; it is the test that fails when someone adds a table and forgets tenancy.
- `periods.test.ts` — `assertDay` accepts and rejects (including `2026-02-31` and `2025-02-29`); the arithmetic survives a DST boundary; weeks start Monday; `periodEnd` is exclusive so periods tile.
- `streaks.test.ts` — one describe block per rule. A skip comes off the target; a week with two of three done on non-consecutive days is kept; a finished period that fell short ends the streak and the period in progress does not.
- `cadence.test.ts` — the ceilings; `assertTargetsFitPeriods` names the offending habit and looks only at the caller's rows.
- `write-guards.test.ts` — no generated mutations exist for `habitEntries`; a habit cannot be created against another user's row; an update that changes only `period` past the ceiling is refused and rolled back.
- `habits.test.ts` — the day round-trips verbatim; marking the same day twice rewrites one row; the streak reflects the write; a future day is refused; an archived habit is refused; the skip cap is per period, not per habit.
- `auth.test.ts`, `bearer.test.ts`, `static.test.ts` — ported from telos.
- `app/src/lib/__tests__/` — the client's mirrored `periods`/`cadence` suites, plus `errors`, `ids`, `readable-text-color`, `hotkeys`.
- `habit-grid.test.tsx` — a daily habit lays out four weeks with a weekday header and no tally; a weekly habit prints the **server's** tally rather than a re-count of the squares; future days are disabled; the click cycle is kept → skipped → cleared.

End-to-end, by hand:

```bash
cp .env.example .env && sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
npm ci
npm run db:up          # postgres:17 on 127.0.0.1:5438
npm run db:migrate
npm run codegen
npm run check          # codegen + biome + tsc --noEmit
npm test
npm run dev            # server 3006, expo 3007
```

Then in the browser: sign in at `/login` → create a daily habit → tick today and watch
the streak become 1 → tick yesterday and watch it become 2 → click today twice more to
skip it, then to clear it → create a "3× a week" habit, keep it on Monday, Wednesday and
Saturday, and confirm the week reads `3/3` with a tick → skip two days of a week and
confirm the target comes down → try a third skip and get a readable refusal → try "40× a
month" and get refused in the form before the request leaves → archive a habit and
confirm its history is still there and its squares no longer take a click.

Then the self-host path, which is the actual product:

```bash
docker compose up --build     # http://localhost:3006 — one container + postgres
```

Confirm migrations ran at boot, the SPA is served from the same origin as `/graphql`, and
a magic link works end to end.

## What changed while building it

The plan above is what was agreed; these are the places the implementation departed from
it, and why.

- **`drizzle-orm` is a root `dependency`, not a `devDependency`.** drizzle-graphql tells a
  column's type apart with `instanceof PgUUID` / `instanceof PgDate`. A second copy of
  drizzle-orm nested under a workspace makes every one of those checks fail — silently,
  by degrading `UUID!` and `DateTime!` in the generated SDL to `String!` and `JSON!`.
  Hoisting it to the root keeps there being one copy, and it has to be a `dependency`
  because the Dockerfile's runtime stage installs with `--omit=dev
  --include-workspace-root`: a dev-only entry there puts the nested copy back in
  production.
- **`react` and `react-dom` are pinned in root `overrides`.** `@testing-library/react`
  hoisted its own newer React to the root while the app's pinned copy sat nested under
  `app/node_modules`, and the dom test project died on "Incompatible React versions".
  Same mechanism already used for `graphql` and `drizzle-orm`, same reason: one copy.
- **The derived fields load the cadence rather than reading it off the parent row.** The
  generated resolvers select the columns the client asked for, so a query for `{ streak }`
  with no `period` alongside it handed the field resolver a row with no cadence on it —
  and `periodOf(undefined, day)` does not fail, it silently answers with a month. Found by
  `habits.test.ts`, which asked for `current` without `period` and got the first of the
  month back. `loaders.cadence` is the fix; drizzle-graphql has no `requiredColumns`
  option to reach for instead.
- **The cadence ceiling moved from a `before` hook to an `after` hook.** Checking the
  mutation's arguments waves through the write that changes only `period` and leaves the
  target where it is.
- **`app/src/lib/periods.ts` duplicates the server's module rather than importing it.**
  An import would pull the server workspace — and its Drizzle imports — into the Metro
  bundle. The two test suites are what keep them honest.
