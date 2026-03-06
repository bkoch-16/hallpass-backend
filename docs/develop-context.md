# Codebase Context — develop

_Generated: 2026-03-06T01:13:23.958Z — 18 files indexed_

## File Summaries

### `.github/workflows/deploy.yml`

CI/CD workflow triggered on pushes to main/develop and pull requests, with three jobs: validate (lint, build, test), deploy-dev (develop branch → Cloud Run dev), and deploy-prod (main branch → Cloud Run prod). The validate job uses dummy environment variables since tests mock the DB, generates the Prisma client, and runs pnpm lint/build/test. Deploy jobs authenticate to GCP, build and push Docker images to Artifact Registry with GitHub Actions cache, and deploy to Cloud Run in us-west1. Environment variables and secrets on Cloud Run are managed externally via GCP Secret Manager, not passed in the workflow. Requires GCP_PROJECT_ID and GCP_SA_KEY GitHub secrets.

### `.github/workflows/index-codebase.yml`

Automated workflow that generates a codebase context document on pushes to develop/main, storing results on a dedicated orphan branch (docs/index). It restores a previous manifest from that branch for incremental indexing, runs a TypeScript indexer script (scripts/index-codebase.ts) powered by the Anthropic API, then commits and pushes updated docs. Uses concurrency control to prevent parallel runs and the [skip ci] commit message convention to avoid recursive triggers. Requires the ANTHROPIC_API_KEY secret and has write permissions on contents.

### `.github/workflows/review-pr.yml`

AI-powered pull request review workflow that runs on PR open/sync/reopen against develop or main. It is restricted to PRs authored by 'bkoch-16' and not by bots. The workflow fetches the full git diff, retrieves the previously generated context document from the docs/index branch, then runs a TypeScript review script (scripts/review-pr.ts) using the Anthropic API. Based on the review output prefix ('Ship it', 'Request changes', or other), it submits a GitHub PR review as approve, request-changes, or comment respectively. HUSKY is disabled to skip git hooks during CI.

### `.github/workflows/sync-develop.yml`

GitHub Actions workflow that automatically keeps the `develop` branch in sync with `main` by opening a PR after every push to `main`. It uses a dedicated `sync/main-to-develop` branch, performs a `--no-ff` merge of main into develop, and either creates a new PR or reuses an existing open one. If the merge encounters conflicts, it aborts and posts a comment on the originating PR (or commit) alerting developers to resolve manually, then exits with failure. The workflow includes early-exit optimizations: it skips if develop already contains all main commits, or if the merge produces no content differences. Requires `contents: write` and `pull-requests: write` permissions and uses `gh` CLI extensively for PR management.

### `apps/user-api/Dockerfile`

Multi-stage Docker build for the user-api service in a pnpm monorepo. It copies package manifests first to optimize layer caching, then installs dependencies, copies source code, generates the Prisma client (using a dummy DATABASE_URL since generate doesn't connect), and builds packages in dependency order (@hallpass/db → auth → logger → user-api). The entrypoint is a custom shell script (docker-entrypoint.sh) that likely handles runtime setup such as database migrations. When modifying, be aware that build order matters due to inter-package dependencies, and any new workspace package consumed by user-api needs its package.json copied in the manifest stage.

### `apps/user-api/src/app.ts`

Main Express application setup for the user-api service. Configures middleware including helmet (security headers), CORS (with configurable origins from env), HTTP logging, JSON body parsing, and two rate limiters—a general 100 req/15min limit and a stricter 10 req/15min limit for auth routes. Routes include Better Auth integration at `/api/auth/*splat`, user routes at `/api/users`, and a `/health` endpoint that verifies database connectivity via Prisma. Depends on shared packages `@hallpass/auth`, `@hallpass/logger`, and `@hallpass/db`, plus local `auth`, `env`, and `userRouter` modules. Includes a 404 catch-all and a global error handler that logs errors and returns 500. The `trust proxy` setting is enabled for running behind a reverse proxy (important for rate limiting accuracy).

### `apps/user-api/src/auth.ts`

Creates and exports the Better Auth instance using the @hallpass/auth package's createAuth factory. Configures auth with baseURL and secret from validated environment variables. This single auth instance is shared by the auth route handler in app.ts and the session validation in the requireAuth middleware.

### `apps/user-api/src/env.ts`

Environment variable validation and export using Zod schemas. Defines required variables `DATABASE_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET`, an optional `PORT`, and `CORS_ORIGIN` defaulting to `"*"`. Parses `process.env` at module load time, so the app will fail fast on startup if required variables are missing. The exported `env` object is the single typed source of truth for configuration used throughout the user-api service.

### `apps/user-api/src/express.d.ts`

TypeScript declaration file that augments the Express Request interface to include an optional user property. The user shape mirrors the Prisma User model (id, email, name, emailVerified, role, createdAt, updatedAt) with the Role type imported from @hallpass/db. This enables type-safe access to req.user throughout route handlers and middleware after authentication.

### `apps/user-api/src/index.ts`

Entry point for the user-api service. Loads environment variables via dotenv/config, imports the validated env config, and starts the Express app on the configured PORT (defaulting to 3001). Registers global handlers for unhandledRejection and uncaughtException that log the error and force process exit, ensuring the process manager can restart the service on fatal errors.

### `apps/user-api/src/middleware/auth.ts`

Express middleware that validates the current session using Better Auth's getSession API by converting Node request headers via fromNodeHeaders. After session validation, it fetches the full user record from Prisma (excluding soft-deleted users) and attaches it to req.user. Returns 401 for missing/invalid sessions or deleted users. Must be applied before any route that needs req.user.

### `apps/user-api/src/middleware/roleGuard.ts`

Provides role-based authorization middleware and utilities. Defines a ROLE_RANK hierarchy (STUDENT=0 through SERVICE=4) with a roleRank() helper for comparing privilege levels. Exports requireRole() which checks if req.user.role is in the allowed set, and requireSelfOrRole() which additionally permits access if the route param :id matches the authenticated user's ID. Both return 401 if no user is present and 403 if authorization fails. Must be used after requireAuth middleware.

### `apps/user-api/src/middleware/validate.ts`

Provides three Zod-based validation middleware factories for Express: validateQuery, validateBody, and validateParams. Each takes a ZodSchema, runs safeParse on the corresponding request property, and returns a 400 response with flattened Zod errors on failure. validateBody replaces req.body with the parsed (cleaned) data on success. validateParams casts the result to Record<string, string>. These are composable and used inline in route definitions.

### `apps/user-api/src/routes/user.ts`

Express router defining CRUD endpoints for user management: batch GET (`/batch`), single GET (`/:id`), POST (`/`), PATCH (`/:id`), and DELETE (`/:id`). Uses Prisma ORM for database operations with soft-delete pattern (filtering/setting `deletedAt`). All routes require authentication via `requireAuth`, with role-based authorization (`requireRole`, `requireSelfOrRole`) and input validation (`validateBody`, `validateParams`, `validateQuery`) applied as middleware. Role hierarchy is enforced using `roleRank` to prevent users from creating, updating, or deleting users of equal or higher privilege. The batch endpoint limits queries to 100 IDs and all read queries use a consistent `select` projection (id, email, name, role, createdAt). The `/batch` route is deliberately registered before `/:id` to avoid route parameter conflicts.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints in the user-api service. Exports four schemas: `batchQuerySchema` for validating batch user queries by IDs, `userIdSchema` for single user ID validation, `updateUserSchema` for partial user updates (requiring at least one field via `.refine()`), and `createUserSchema` for user creation with required email/name and optional role. The role field is constrained to an enum of "STUDENT", "TEACHER", "ADMIN", and "SUPER_ADMIN". Depends on the `zod` library for runtime validation; these schemas are likely used with a middleware or controller layer to validate incoming request data.

### `docker-compose.yml`

Local development Docker Compose configuration defining two services: a PostgreSQL 16 database and the user-api application. Postgres uses a named volume for data persistence and includes a health check; the user-api service depends on Postgres being healthy before starting. Environment variables BETTER_AUTH_SECRET and BETTER_AUTH_URL are expected from the host environment (or .env file), while DATABASE_URL is hardcoded to the internal Docker network. The user-api is exposed on port 3001 and built from the monorepo root context using the Dockerfile in apps/user-api/.

### `packages/auth/src/index.ts`

Provides a shared authentication configuration factory using the `better-auth` library for the @hallpass monorepo. The `createAuth` function accepts a `baseURL` and `secret`, configures a Prisma adapter with PostgreSQL (via `@hallpass/db`), enables email/password authentication, and sets session expiry to 7 days with a 1-day update age. Exports the `Auth` and `Session` types inferred from the auth instance, as well as `toNodeHandler` and `fromNodeHeaders` utilities for integrating with Node.js HTTP servers. Consumers instantiate auth by calling `createAuth` with environment-specific config; modifying session strategy or auth plugins should be done here as this is the centralized auth setup.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema using Prisma ORM for the HallPass application. Contains a Role enum (STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE) and three models: User (with soft-delete via deletedAt), Session (token-based with IP/user-agent tracking), and Account (multi-provider auth support with optional password). Sessions and Accounts cascade-delete when their parent User is removed. IDs use cuid() generation. Any schema changes here require a Prisma migration and will affect the generated Prisma client used throughout the monorepo via @hallpass/db.
