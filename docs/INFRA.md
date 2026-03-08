## Project Overview
Hallpass backend — a Node.js monorepo providing API services for a digital hall pass system. Managed with pnpm workspaces and Turborepo.

## Packages
- `apps/user-api` — Main Express 5 REST API
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
```

## Environment Variables

| Variable | Default | Required |
|---|---|---|
| `DATABASE_URL` | — | Yes |
| `BETTER_AUTH_SECRET` | — | Yes |
| `BETTER_AUTH_URL` | `http://localhost:3001` | No |
| `CORS_ORIGIN` | — | Yes |
| `PORT` | `3001` | No |

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
- Migrations run automatically on deploy via `docker-entrypoint.sh`

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
| student@hallpass.dev | password | STUDENT |
| teacher@hallpass.dev | password | TEACHER |
| admin@hallpass.dev | password | ADMIN |
| superadmin@hallpass.dev | password | SUPER_ADMIN |

## Authentication & Rate Limiting

- Auth handled by better-auth via `/api/auth/*` routes
- General endpoints: 100 req / 15 min
- Auth endpoints: 10 req / 15 min

## Deployment

| Branch | Environment | Service |
|---|---|---|
| `develop` | Dev | `user-api-dev` |
| `main` | Prod | `user-api` |

GitHub Actions workflow: lint → build → test → Docker build → push to GCP Artifact Registry → deploy to Cloud Run → run migrations.

Secrets are managed directly on the Cloud Run service (not in the workflow).

## Conventions

- **Prettier**: 2-space indent, double quotes, semicolons, trailing commas
- **ESLint**: TypeScript strict, unused vars flagged (prefix with `_` to suppress)
- **Husky**: pre-push hook runs `pnpm lint && pnpm test` — fix before pushing
- **Unused vars**: prefix with `_` (e.g., `_unusedParam`)
- Do not skip the pre-push hook (`--no-verify`)