# Codebase Context — develop

_Generated: 2026-07-09T20:39:29.729Z — 17 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a Demo UI to GitHub Pages. Triggers on pushes to main when Postman collections, the demo generation script, or demo-ui app files change, plus manual dispatch. Uses pnpm with Node 22, runs `pnpm demo:generate` to build static HTML, then deploys the `./apps/demo-ui` directory to the `gh-pages` branch using the peaceiris/actions-gh-pages action. Requires `contents: write` permission for pushing to gh-pages. Developers modifying this should note the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var and that the generation script path (`scripts/generate-demo.ts`) and publish directory must stay in sync.

### `.github/workflows/deploy.yml`

CI/CD workflow for the HallPass backend monorepo that validates (lint, build, test) on every push/PR, then deploys to dev or prod environments on Google Cloud Run. Triggered by pushes to `main` (prod) or `develop` (dev), PRs (validate only), or manual `workflow_dispatch` with an environment selector. Uses a matrix strategy to deploy three microservices (`user-api`, `schools-api`, `passes-api`) as separate Cloud Run services, with Docker images pushed to GCP Artifact Registry and cached via GitHub Actions cache. Database migrations run via `prisma migrate deploy` against Neon databases, with connection strings fetched securely from GCP Secret Manager at runtime to avoid log exposure. The validate job uses dummy env vars since tests mock `@hallpass/db` but env validation still requires them. Developers modifying this file should note: env vars/secrets on Cloud Run are managed in GCP directly (not in the workflow), the pnpm monorepo filter `@hallpass/db` targets the shared Prisma package, and prod deploys additionally require the workflow to run from `main`.

### `.github/workflows/index-codebase.yml`

Workflow that generates an AI-powered codebase context/index document using the Anthropic API. Triggers on pushes to `develop`/`main` or manual dispatch with branch selection, and stores results on an orphan `docs/index` branch. Implements incremental indexing by restoring a previous manifest JSON before running the indexer script (`scripts/index-codebase.ts`). Uses serialized concurrency (`docs-index` group, no cancellation) and a 15-minute timeout. Developers modifying this should note the branch-slug naming convention for manifests and that the `ANTHROPIC_API_KEY` secret is required.

### `.github/workflows/review-pr.yml`

AI-powered PR review workflow using Claude (Anthropic API) that runs on PR events targeting `develop`/`main` or via manual dispatch with a PR number. Restricted to PRs authored by `bkoch-16` and excludes bot-triggered events. Generates a unified diff with 20 lines of context, fetches a codebase context document from the `docs/index` branch, then runs `scripts/review-pr.ts` to produce a review. The review action (approve, request-changes, or comment) is determined by parsing the first line of the generated `review.md`. Requires `ANTHROPIC_API_KEY` secret and `pull-requests: write` permission; sets `HUSKY=0` to skip git hooks.

### `.github/workflows/sync-develop.yml`

Automation workflow that keeps the `develop` branch in sync with `main` by creating a merge PR after each push to `main`. First checks if `develop` already contains all `main` commits (early exit if so), then creates/updates a `sync/main-to-develop` branch with a no-ff merge. On merge conflicts, it aborts and posts a conflict notification as a comment on the originating PR or commit. Uses `--force-with-lease` for safe pushes and avoids creating duplicate PRs by checking for existing open sync PRs. Requires both `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Dockerfile for the user-api service, building a Node.js 22 Alpine image with pnpm 10 in a monorepo context. It copies package manifests first for Docker layer caching, then installs dependencies with a frozen lockfile before copying source code. A Prisma client is generated using a dummy DATABASE_URL (no actual DB connection needed at build time), followed by sequential builds of internal packages (@hallpass/db, auth, logger, types, express-middleware) and the user-api app itself. The container exposes port 3001 and uses a custom docker-entrypoint.sh script as its entrypoint. Developers modifying this file should ensure the COPY and build order matches the monorepo dependency graph, and that any new internal packages are added to both the manifest copy and build steps.

### `apps/user-api/src/app.ts`

Configures and exports the Express application for the user-api service, wiring up middleware in a specific order: helmet, CORS, HTTP logging, JSON parsing, health check (before rate limiting), rate limiters, auth routes, user routes, 404 handler, and error handler. Rate limiting uses Redis-backed stores (via rate-limit-redis/RedisStore) in production and falls back to in-memory stores during tests or when REDIS_URL is unset; each limiter gets its own RedisStore instance with namespaced keys. Auth routes are handled by `@hallpass/auth`'s `toNodeHandler` adapter with a stricter auth-specific rate limiter. Key dependencies include shared packages `@hallpass/auth`, `@hallpass/logger`, and `@hallpass/express-middleware`. The `trust proxy` setting is enabled for running behind load balancers (e.g., Cloud Run). Developers modifying this file should preserve middleware ordering, especially keeping the health route before rate limiters.

### `apps/user-api/src/auth.ts`

Configures and exports the application's authentication instance using `createAuth` from `@hallpass/auth`. It reads configuration from environment variables (`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGIN`) via the `env` module. Trusted origins are conditionally set: if `CORS_ORIGIN` is `"*"`, no trusted origins are specified (allowing all); otherwise, origins are parsed using `parseCorsOrigins` from `@hallpass/express-middleware`. Developers modifying this file should be aware of the dependency on the `env.ts` module for validated environment variables and the shared `@hallpass/auth` and `@hallpass/express-middleware` packages.

### `apps/user-api/src/env.ts`

Validates and exports the environment configuration for the user-api service using Zod schemas from `@hallpass/express-middleware`. Extends `baseEnvSchema` with optional Redis environment variables (REDIS_URL, REDIS_PREFIX) and applies a refinement ensuring REDIS_PREFIX is provided whenever REDIS_URL is set. The parsed `env` object is used throughout the app for type-safe environment access. When modifying, ensure any new required environment variables are added to the schema and reflected in docker-compose.yml and deployment configs.

### `apps/user-api/src/index.ts`

Entry point for the user-api service that loads dotenv, validates environment variables (via env.ts import), and starts the Express server on the configured PORT (default 3001). Registers global handlers for unhandledRejection and uncaughtException that log and exit with code 1 to ensure clean restarts in containerized environments.

### `apps/user-api/src/middleware/auth.ts`

Exports a `requireAuth` Express middleware created via the `createRequireAuth` factory from `@hallpass/express-middleware`, configured with the local `auth` instance. This middleware should be used on routes that need an authenticated user; it populates `req.user` on success. Changing the auth provider or configuration should be done in `../auth.js`, not here.

### `apps/user-api/src/routes/user.ts`

Express router defining CRUD endpoints for user management: GET /me, GET / (cursor-paginated list with optional ?ids= batch lookup), GET /:id, POST / (create), POST /bulk (bulk create), PATCH /:id (update), and DELETE /:id (soft delete via deletedAt). Uses Prisma for database access with a consistent USER_SELECT projection and a toUserResponse helper to normalize output. Enforces role-based access control via requireAuth, requireRole, requireSelfOrRole, and roleRank utilities, ensuring users cannot create/modify/delete users of equal or higher rank, and non-SUPER_ADMIN users are scoped to their schoolId. Request validation is handled by validateBody/validateParams/validateQuery with Zod schemas imported from ../schemas/user.js. Soft-deleted records (deletedAt != null) are excluded from all queries. When modifying, note the route ordering matters (/me before /:id), the 100-ID batch limit, Prisma error code handling (P2002 for unique conflicts, P2003 for FK violations), and that bulk create uses Promise.allSettled for partial-success semantics returning BulkUserResult.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints. Exports `userIdSchema` (path param), `listUsersSchema` (query params with cursor pagination, optional role filter, and comma-separated ids), `createUserSchema` (email, name, optional role), `bulkCreateSchema` (array of 1-100 create schemas), and `updateUserSchema` (partial update requiring at least one field, with nullable schoolId). Role fields are constrained to `ASSIGNABLE_ROLES` from `@hallpass/types`. The `limit` field uses `z.coerce.number()` for query string parsing with a default of 50.

### `docker-compose.yml`

Defines the local development stack for the Hallpass platform with four services: PostgreSQL 16 (database), Redis 7 (rate-limit/caching store), user-api (port 3001), and schools-api (port 3002). Both API services depend on healthy Postgres and Redis containers and share a common database URL pattern. Environment variables like BETTER_AUTH_SECRET and CORS_ORIGIN can be overridden via a .env file or shell environment. A named volume `postgres_data` persists database data across container restarts. Developers should note that both APIs share the same Postgres database and Redis instance, and the build context for both is the repo root (monorepo pattern with per-app Dockerfiles).

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm 10.30.1 and Turborepo for orchestrating build, dev, lint, test, and integration test tasks across workspaces. Scripts include demo generation (via tsx), formatting (Prettier), and git hooks (Husky). The pnpm config pins ioredis to 5.10.0 via overrides and restricts native builds to Prisma engines, esbuild, and prisma. Dev dependencies cover linting (ESLint + typescript-eslint + prettier), build tooling (TypeScript, tsx, turbo), and scripting utilities (fast-glob, micromatch, yaml). The only runtime dependency at root level is @anthropic-ai/sdk.

### `packages/auth/src/index.ts`

This file is the central authentication configuration module for the project, responsible for creating and exporting a `betterAuth` instance. It exports `createAuth`, a factory function that configures BetterAuth with a Prisma/PostgreSQL adapter (using the shared `@hallpass/db` prisma client), the `bearer` plugin, email/password authentication, serial ID generation, and session settings (7-day expiry, 1-day update age). When the `baseURL` is HTTPS, it automatically sets `sameSite: 'none'` and `secure: true` on cookies for cross-origin support. Key exports include the `Auth` and `Session` types (inferred from the auth instance), plus `toNodeHandler` and `fromNodeHeaders` re-exported from `better-auth/node` for HTTP integration. Developers modifying this file should be aware that changes here affect all authentication behavior across the monorepo, and the Prisma adapter depends on the `@hallpass/db` package's schema being in sync.

### `packages/db/prisma/schema.prisma`

Defines the full PostgreSQL data model for the HallPass system using Prisma ORM, covering districts, schools, users (with Role enum), sessions, accounts, schedule types, periods, school calendars, destinations, pass policies, and passes (with PassStatus enum lifecycle). Key relationships include school-scoped users, multi-relation user-to-pass links (student, requester, approver, denier, canceller), and a one-to-one PassPolicy per school. The Pass model has a critical WARNING comment: a partial unique index (one_active_pass_per_student) exists only in a migration and not in the schema, so developers must manually remove any auto-generated DROP INDEX statements in new migrations. Passes intentionally lack a deletedAt field—they use terminal statuses instead of soft deletion. Indexes are defined on frequently queried foreign keys and status fields for pass lookups.
