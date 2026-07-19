## Project Overview
Hallpass backend — a Node.js monorepo providing API services for a digital hall pass system. Managed with pnpm workspaces and Turborepo.

## Packages
- `apps/user-api` — Main Express 5 REST API
- `apps/schools-api` — Districts, schools, schedule types, periods, calendar, destinations, and pass policy REST API
- `apps/passes-api` — Hall pass lifecycle REST API with real-time WebSocket support and scheduled pass expiry
- `packages/auth` — Authentication layer (better-auth)
- `packages/db` — Database access (Prisma + PostgreSQL)
- `packages/logger` — Shared structured logging (Pino)
- `packages/types` — Shared TypeScript types (enums, response shapes, request bodies)


## Tech Stack

- **Runtime**: Node.js 22
- **Framework**: Express 5
- **Language**: TypeScript
- **ORM**: Prisma with PostgreSQL (Neon serverless in cloud, local Docker for dev)
- **Auth**: better-auth
- **Validation**: Zod
- **Logging**: Pino + pino-http
- **Testing**: Vitest + Supertest
- **Package Manager**: pnpm 10
- **Monorepo**: Turborepo
- **Deployment**: Google Cloud Run (us-west1)

## Local Setup

```bash
# 1. Start local PostgreSQL
docker-compose up -d

# 2. Install dependencies
pnpm install

# 3. Generate Prisma client
pnpm --filter @hallpass/db exec prisma generate

# 4. Run migrations
pnpm --filter @hallpass/db exec prisma migrate dev

# 5. Seed database
pnpm --filter @hallpass/db db:seed

# 6. Start dev server (port 3001)
pnpm dev
```

## Commands

```bash
pnpm dev           # Start all services in watch mode
pnpm build         # Build all packages (Turborepo-ordered)
pnpm test          # Run all tests
pnpm lint          # ESLint across all packages
pnpm format        # Prettier format all files
pnpm format:check  # Check formatting without writing

# Run for a specific package
pnpm --filter @hallpass/user-api test
pnpm --filter @hallpass/user-api lint
pnpm --filter @hallpass/schools-api test
pnpm --filter @hallpass/schools-api lint
```

## Environment Variables

Common to `user-api` and `schools-api`:

| Variable | Default | Required |
|---|---|---|
| `DATABASE_URL` | — | Yes |
| `BETTER_AUTH_SECRET` | — | Yes |
| `BETTER_AUTH_URL` | `http://localhost:3001` | No |
| `CORS_ORIGIN` | — | Yes |
| `PORT` | `3001` | No |

`user-api` only — outbound email (password-reset messages) via Amazon SES:

| Variable | Default | Required |
|---|---|---|
| `AWS_REGION` | — | No* |
| `AWS_ACCESS_KEY_ID` | — | No* |
| `AWS_SECRET_ACCESS_KEY` | — | No* |
| `EMAIL_FROM` | — | No* |
| `WEB_APP_URL` | — | With SES |

*All-or-nothing: set all four to send real email through SES, or none to fall
back to logging the message (local dev, tests). `WEB_APP_URL` is the origin
reset links point at (the demo UI on GitHub Pages today) and is required
whenever SES is configured. The IAM key should be scoped to `ses:SendEmail`
on the verified identity only.

`REDIS_URL`/`REDIS_PREFIX` are **optional** for `user-api` (falls back to
express-rate-limit's in-memory store when unset) but **required** for
`schools-api` (its public, no-session calendar/schedule-type endpoints — see
below — need Redis-backed limits that hold across cold starts/instances, not
per-instance in-memory counters). When `REDIS_URL` is set the rate limiters use
a shared-Redis store keyed `<REDIS_PREFIX>:rl:<service>:<general|auth|...>:` so
counters aggregate across instances and survive cold starts. The active store
is logged at boot (`rate-limit store: redis|in-memory`). `passes-api`
additionally **requires** `REDIS_URL`/`REDIS_PREFIX` (see its section) since it
also uses Redis for slot counters and the socket.io adapter.

`schools-api` additionally **requires** `PARENT_TOOL_API_KEY` — the same key
`passes-api` uses for its `parent-lookup` endpoint (see below), accepted as an
alternative to a session on `GET /api/schools/:schoolId/calendar`,
`GET /api/schools/:schoolId/schedule-types`, and
`GET /api/schools/:schoolId/schedule-types/:scheduleTypeId/periods` so the
parent-tool voice AI can read school calendar/schedule-type/period data
without a session.

## Architecture

```
apps/user-api/src/
├── index.ts          # Entry point
├── app.ts            # Express app setup
├── env.ts            # Env var validation (Zod)
├── auth.ts           # Auth configuration
├── routes/           # Route handlers
├── middleware/       # Express middleware
├── schemas/          # Zod validation schemas
└── lib/              # Utilities
```

```
apps/schools-api/src/
├── index.ts          # Entry point
├── app.ts            # Express app setup
├── env.ts            # Env var validation (Zod)
├── auth.ts           # Auth configuration
├── routes/           # Route handlers (district, school, scheduleType, period, calendar, destination, policy)
├── middleware/       # Express middleware (auth, roleGuard, schoolScope, validate)
└── schemas/          # Zod validation schemas
```

**Layers:**
1. Routes (`routes/`) — request handling
2. Middleware (`middleware/`) — auth, logging, rate limiting
3. Validation (`schemas/`) — Zod schemas
4. Data (`@hallpass/db`) — Prisma ORM singleton

## Types Package

`@hallpass/types` is a zero-dependency package that exports shared TypeScript contracts consumed by `apps/user-api` (and future apis):

- **Enums**: `UserRole`, `PassStatus`, `PolicyInterval`, `ASSIGNABLE_ROLES`
- **Pagination**: `CursorPage<T>`
- **Response shapes**: `UserResponse`, `PassResponse`, `SchoolResponse`, `DistrictResponse`, `DestinationResponse`, `PassPolicyResponse`, `ScheduleTypeResponse`, `PeriodResponse`, `SchoolCalendarResponse`
- **Request bodies**: `Create*Body` / `Update*Body` interfaces for all resources, `UpsertPassPolicyBody`, `CalendarEntryBody`
- **Bulk operation results**: `BulkUpsertResult`, `BulkUserResult`, `BulkUserFailure`

Built with `tsc` (no runtime dependencies). Import from `@hallpass/types`.

## Database

- Prisma schema: `packages/db/prisma/schema.prisma`
- Migrations: `packages/db/prisma/migrations/` (version-controlled)
- Single PrismaClient instance per process
- Migrations run once per deploy in the `migrate-{env}` CI job (before the deploy
  matrix), not in the container entrypoint — see `.github/workflows/deploy.yml`

**Common commands:**
```bash
# Create a new migration
pnpm --filter @hallpass/db exec prisma migrate dev --name <name>

# Apply migrations (production)
pnpm --filter @hallpass/db exec prisma migrate deploy

# Open Prisma Studio
pnpm --filter @hallpass/db exec prisma studio
```

**Seed users (dev only):**
| Email | Password | Role |
|---|---|---|
| student@gohallhero.com | password | STUDENT |
| teacher@gohallhero.com | password | TEACHER |
| admin@gohallhero.com | password | ADMIN |
| superadmin@gohallhero.com | password | SUPER_ADMIN |

## Authentication & Rate Limiting

- Auth handled by better-auth via `/api/auth/*` routes
- General endpoints: 100 req / 15 min
- Auth endpoints: 10 req / 15 min

**ID strategy:** Every table uses `Int @id @default(autoincrement())` — domain models (`District`, `School`, `User`, `ScheduleType`, `Period`, `SchoolCalendar`, `Destination`, `PassPolicy`) and auth-infrastructure tables (`Session`, `Account`) alike. better-auth is configured with `generateId: "serial"`, which requires numeric DB-generated ids on every table it manages; any future better-auth plugin tables must also use `Int` serial ids.

## Deployment

| Branch    | Environment | Service           |
|-----------|-------------|-------------------|
| `develop` | Dev         | `user-api-dev`    |
| `develop` | Dev         | `schools-api-dev` |
| `develop` | Dev         | `passes-api-dev`  |
| `main`    | Prod        | `user-api`        |
| `main`    | Prod        | `schools-api`     |
| `main`    | Prod        | `passes-api`      |

GitHub Actions workflow: lint → build → test → migrate (once, per env) → Docker build → push to GCP Artifact Registry → deploy to Cloud Run.

The `migrate-{env}` job fetches the env's `DATABASE_URL*` secret from Secret
Manager and runs `prisma migrate deploy` a single time before the deploy matrix,
so containers no longer migrate on boot. The CI service account
(`github-actions-deploy@hallpass-access.iam.gserviceaccount.com`) therefore needs
`roles/secretmanager.secretAccessor` on each environment's `DATABASE_URL*` secret.

## passes-api

### Cloud Run Service Names
- **Prod**: `passes-api`
- **Dev**: `passes-api-dev`

### Port
`3003`

### Dependencies
- **Neon Postgres** (`DATABASE_URL`) — primary data store via Prisma
- **Upstash Redis** (`REDIS_URL`) — Socket.io adapter (pub/sub across instances), slot counters, and the rate-limit store
- **Socket.io** — WebSocket upgrade handled on the same HTTP server; real-time pass status events
- **Pass expiry** — an in-process `setTimeout` per pass fires at the period end while the instance is warm (which it is whenever a staff board is connected). No polling worker. The `passes-reconcile-expiry` Cloud Scheduler job (`*/10`) is the cold-path backstop: it expires any pass that came due while no instance was warm and re-arms timers on a freshly-woken instance. Worst-case expiry lag = the scheduler interval. Config edits are applied lazily by the same path: `maxOccupancy` shrinks and period `endTime` edits do **not** immediately update the Redis slot counters or already-armed timers — those reflect the old values until the reconcile sweep catches up, so worst-case staleness is likewise the scheduler interval.

### Required Environment Variables
| Variable             | Description                                              |
|----------------------|----------------------------------------------------------|
| `DATABASE_URL`       | Neon Postgres connection string                          |
| `BETTER_AUTH_URL`    | Base URL of the auth service                             |
| `BETTER_AUTH_SECRET` | Shared secret for better-auth session verification       |
| `REDIS_URL`          | Upstash Redis URL (Socket.io adapter, slot counters, rate-limit store) |
| `REDIS_PREFIX`       | Per-environment Redis key namespace (`dev` / `prod`; use `local` for local dev). Required — no default; boot fails with a ZodError if unset. Dev and prod share one Upstash DB (free tier), so this MUST differ per environment or the two cross-contaminate each other's slot counters, rate-limit keys, and socket.io adapter channels |
| `CORS_ORIGIN`        | Allowed CORS origin(s)                                   |
| `INTERNAL_SECRET`    | Shared secret for the /internal/* routes (Cloud Scheduler) |
| `PORT`               | HTTP listen port (defaults to `3003`)                    |

### Notes
- Socket.io WebSocket upgrade is handled on the same HTTP server instance — no separate WS server or port needed.
- Pass expiry runs on in-process timers, not a job queue — no worker process to start. Redis is still used (Socket.io adapter, slot counters, rate-limit) but the connection is lazy, so a brief Redis outage does not block boot.
- Env vars and secrets are managed directly on the Cloud Run service via GCP Secret Manager — nothing is passed through the workflow.

Secrets are managed directly on the Cloud Run service (not in the workflow).

## One-time Cloud Run service setup (runbook)

A brand-new service created by the deploy workflow starts with **zero env config and no public invoker access** — the workflow intentionally passes only the image. The first deploy of any new service therefore always fails ("container failed to listen on PORT=8080" — a ZodError from `env.ts` on missing vars). This is expected; run the setup below once, and the failed revision recovers on the next `services update`. Note migrations no longer run in the container, so a missing `DATABASE_URL` no longer breaks boot; instead the `migrate-{env}` CI job fails first if the CI service account lacks `secretAccessor` on the env's `DATABASE_URL*` secret.

Recipe (per environment; dev secrets carry a `_DEV` suffix, prod secrets are unsuffixed):
1. Create any missing secrets and grant `roles/secretmanager.secretAccessor` to the compute SA (`509242588558-compute@developer.gserviceaccount.com`).
2. `gcloud run services update <service> --region us-west1 --set-secrets=... --set-env-vars=CORS_ORIGIN=...` (passes-api also needs `REDIS_PREFIX` and `--session-affinity` for socket.io).
3. `gcloud run services add-iam-policy-binding <service> --region us-west1 --member=allUsers --role=roles/run.invoker`
4. passes-api only: create the reconcile scheduler job (mandatory heartbeat — scale-to-zero means its interval is the worst-case pass-expiry lag).

### Redis-backed rate limiting on user-api / schools-api (one-time)

`user-api` uses a Redis rate-limit store **when `REDIS_URL` is set** (optional —
it falls back to in-memory otherwise, so this is safe to run before or after the
deploy; the extra env is ignored by the current revision until the new code
ships). `schools-api` now **requires** `REDIS_URL`/`REDIS_PREFIX` (no in-memory
fallback — see "schools-api: PARENT_TOOL_API_KEY" below), so its update must run
before deploying that change or the revision fails to boot. No IAM grant needed
for either — they run as the compute SA, which already has `secretAccessor` on
`REDIS_URL`/`REDIS_URL_DEV`.

```bash
# dev
gcloud run services update user-api-dev   --region us-west1 \
  --set-secrets=REDIS_URL=REDIS_URL_DEV:latest --set-env-vars=REDIS_PREFIX=dev
gcloud run services update schools-api-dev --region us-west1 \
  --set-secrets=REDIS_URL=REDIS_URL_DEV:latest --set-env-vars=REDIS_PREFIX=dev
# prod (before/with the first main deploy of this change)
gcloud run services update user-api    --region us-west1 \
  --set-secrets=REDIS_URL=REDIS_URL:latest --set-env-vars=REDIS_PREFIX=prod
gcloud run services update schools-api --region us-west1 \
  --set-secrets=REDIS_URL=REDIS_URL:latest --set-env-vars=REDIS_PREFIX=prod
```

Verify: boot log shows `rate-limit store: redis`; Upstash shows
`<prefix>:rl:user-api:*` / `<prefix>:rl:schools-api:*` keys.

### schools-api: PARENT_TOOL_API_KEY (one-time)

`schools-api` now requires `REDIS_URL`/`REDIS_PREFIX` (no more in-memory
fallback — see above) and a new `PARENT_TOOL_API_KEY` secret, reusing the same
value already stored in the `PARENT_TOOL_API_KEY`/`PARENT_TOOL_API_KEY_DEV`
secrets used by `passes-api`. Run before deploying this change, or the
revision fails to boot with a ZodError:

```bash
# dev
gcloud run services update schools-api-dev --region us-west1 \
  --set-secrets=PARENT_TOOL_API_KEY=PARENT_TOOL_API_KEY_DEV:latest
# prod
gcloud run services update schools-api --region us-west1 \
  --set-secrets=PARENT_TOOL_API_KEY=PARENT_TOOL_API_KEY:latest
```

Verify: `/health` returns 200 on both services after deploy; a request to
`GET /api/schools/:schoolId/calendar` with `x-api-key: <key>` and no session
cookie returns 200.

### passes-api prod (Phase B — run after the first `main` deploy creates the service)

Phase A (done 2026-07-06): prod `REDIS_URL` + `INTERNAL_SECRET` secrets created with compute-SA access; prod DB migrations applied.

```bash
gcloud run services update passes-api --region us-west1 \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest,BETTER_AUTH_URL=BETTER_AUTH_URL:latest,REDIS_URL=REDIS_URL:latest,INTERNAL_SECRET=INTERNAL_SECRET:latest \
  --set-env-vars=CORS_ORIGIN=https://bkoch-16.github.io,REDIS_PREFIX=prod \
  --session-affinity

gcloud run services add-iam-policy-binding passes-api --region us-west1 \
  --member=allUsers --role=roles/run.invoker

gcloud scheduler jobs create http passes-reconcile-expiry \
  --location us-west1 --schedule="*/10 * * * *" \
  --uri=https://passes-api-509242588558.us-west1.run.app/internal/reconcile-expiry \
  --http-method=POST \
  --headers=Authorization="Bearer $(gcloud secrets versions access latest --secret=INTERNAL_SECRET)"
```

Verify: `/health` returns 200; `gcloud scheduler jobs run passes-reconcile-expiry --location us-west1` succeeds and logs `{scheduled, reconciled}`; Upstash data browser shows `prod:*` keys alongside `dev:*` with no unprefixed strays.

One-time BullMQ key cleanup (after this deploy is verified): pass expiry no longer uses BullMQ, so all of its keys are permanently dead — the pre-prefix `bull:pass-expiry:*` set (completed/failed sets and meta have no TTL and persist forever on a noeviction free-tier DB) plus the prefixed `{dev,prod}:pass-expiry:*` keys from the BullMQ era. The old `slots:*` counters (24h TTL, self-expire) and default `socket.io` adapter channel state from the pre-prefix deploy can go too. Delete them from the Upstash data browser, or via redis-cli:

    redis-cli --tls -u "$REDIS_URL" --scan --pattern 'bull:*'         | xargs -L 100 redis-cli --tls -u "$REDIS_URL" DEL
    redis-cli --tls -u "$REDIS_URL" --scan --pattern '*:pass-expiry:*' | xargs -L 100 redis-cli --tls -u "$REDIS_URL" DEL
    redis-cli --tls -u "$REDIS_URL" --scan --pattern 'slots:*'        | xargs -L 100 redis-cli --tls -u "$REDIS_URL" DEL

Safe to run: expiry is now driven by in-process timers and the `passes-reconcile-expiry` sweep, so no queued jobs are lost — any in-flight pass is re-armed or expired on the next scheduler run.

The passes-api general-limiter prefix moved from `<prefix>:rl:general:` to `<prefix>:rl:passes-api:general:` (uniform `:rl:<service>:` scheme across all three services). The old `*:rl:general:*` keys are orphaned but self-expire within the 15-minute limiter window, so no cleanup is required.

## Conventions

- **Prettier**: 2-space indent, double quotes, semicolons, trailing commas
- **ESLint**: TypeScript strict, unused vars flagged (prefix with `_` to suppress)
- **Husky**: pre-push hook runs `pnpm lint && pnpm test` — fix before pushing
- **Unused vars**: prefix with `_` (e.g., `_unusedParam`)
- Do not skip the pre-push hook (`--no-verify`)