# Codebase Context — main

_Generated: 2026-03-06T02:41:45.950Z — 18 files indexed_

## File Summaries

### `.github/workflows/deploy.yml`

CI/CD pipeline for the backend with three jobs: `validate` (lint, build, test on all branches/PRs), `deploy-dev` (pushes to `develop` deploy to Cloud Run dev), and `deploy-prod` (pushes to `main` deploy to Cloud Run prod). The validate job uses dummy environment variables since tests mock the DB. Docker images are built with Buildx, pushed to GCP Artifact Registry with both SHA and `latest` tags, and use GitHub Actions cache for layer reuse. Cloud Run environment variables and secrets are managed directly on the service via GCP Secret Manager rather than being passed in the workflow. Requires `GCP_PROJECT_ID` and `GCP_SA_KEY` repository secrets.

### `.github/workflows/index-codebase.yml`

Automated codebase indexing workflow that runs on pushes to `develop` and `main`, generating context documents for AI-assisted development. It restores a previous manifest from the `docs/index` orphan branch (for incremental indexing), runs `scripts/index-codebase.ts` using the Anthropic API, and pushes generated docs back to the `docs/index` branch. Uses concurrency control (`cancel-in-progress: false`) to prevent parallel runs from conflicting. The branch-slug naming convention allows separate context documents per branch. Requires the `ANTHROPIC_API_KEY` secret.

### `.github/workflows/review-pr.yml`

AI-powered pull request review workflow using Claude (Anthropic API) that triggers on PR open/sync/reopen against `develop` or `main`. It's restricted to PRs authored by `bkoch-16` (not bot-authored). It generates a diff against the base branch, fetches the codebase context document from the `docs/index` branch, and runs `scripts/review-pr.ts` to produce a review. The review action (approve, request-changes, or comment) is determined by parsing the first line of the AI output. Requires `ANTHROPIC_API_KEY` secret and uses the default `GITHUB_TOKEN` for PR review submission.

### `.github/workflows/sync-develop.yml`

GitHub Actions workflow that automatically syncs the `develop` branch with `main` after every push to `main`. It creates a `sync/main-to-develop` branch, attempts a no-fast-forward merge of `main` into `develop`, and opens a pull request if there are differences. If the merge encounters conflicts, it aborts, posts a comment on the originating PR or commit notifying of the failure, and exits with an error. The workflow uses force-with-lease pushes to update the sync branch and avoids creating duplicate PRs by checking for existing open sync PRs. Requires `contents: write` and `pull-requests: write` permissions; developers should be aware that merge conflicts require manual resolution and that the sync branch is reset to `origin/develop` on each run if it already exists.

### `apps/user-api/Dockerfile`

Multi-stage Docker build for the user-api Express service, based on node:22-alpine with pnpm 10. It uses a layer-caching strategy by copying package manifests first, then source code, to avoid busting the dependency install layer on code-only changes. After installing dependencies, it generates the Prisma client (using a dummy DATABASE_URL since generate doesn't connect to a DB) and builds internal packages in dependency order (@hallpass/db → auth → logger → user-api). The entrypoint is a custom shell script (`docker-entrypoint.sh`), and the service listens on port 3001. Developers modifying this file should ensure any new workspace packages have their package.json copied in the manifest layer and are added to the build chain.

### `apps/user-api/src/app.ts`

Main Express application setup for the user-api service, responsible for wiring all middleware and routes. It configures helmet (security headers), CORS (configurable origins via env), pino HTTP logging, JSON body parsing, and two rate limiters (general 100 req/15min, auth 10 req/15min). Routes include BetterAuth handler at `/api/auth/*splat`, user CRUD at `/api/users`, and a `/health` endpoint that verifies database connectivity via Prisma. It includes a 404 catch-all and a global error handler. The `trust proxy` setting is enabled for deployment behind a reverse proxy (Cloud Run).

### `apps/user-api/src/auth.ts`

Creates and exports the Better Auth instance used throughout the user-api service. Delegates to `createAuth` from the `@hallpass/auth` package, configured with `baseURL` and `secret` from validated environment variables. This is the single auth instance imported by both the auth route handler in `app.ts` and the `requireAuth` middleware.

### `apps/user-api/src/env.ts`

Environment variable validation module using Zod schema parsing. It requires DATABASE_URL, BETTER_AUTH_URL, and BETTER_AUTH_SECRET to be present, with PORT as optional and CORS_ORIGIN defaulting to "*". The validated `env` object is exported for type-safe access throughout the application. This file will throw at startup if required environment variables are missing, which is intentional for fail-fast behavior.

### `apps/user-api/src/express.d.ts`

Augments the global Express `Request` interface to include an optional `user` property, typed to match the Prisma `User` model fields (id, email, name, emailVerified, role, createdAt, updatedAt). The `role` field uses the `Role` enum imported from `@hallpass/db`. This declaration enables type-safe access to `req.user` throughout middleware and route handlers without casting.

### `apps/user-api/src/index.ts`

Entry point for the user-api service. Loads environment variables via `dotenv/config`, starts the Express server on the configured PORT (defaulting to 3001), and registers global handlers for `unhandledRejection` and `uncaughtException` that log and force-exit the process. This file should remain minimal; application setup belongs in `app.ts`.

### `apps/user-api/src/middleware/auth.ts`

Exports `requireAuth`, an Express middleware that validates the session by calling Better Auth's `getSession` API with converted Node headers. On success, it fetches the full user record from Prisma (excluding soft-deleted users) and attaches it to `req.user`. Returns 401 if the session is invalid, missing, or the user is not found/deleted. Must be applied before any role-checking middleware since they depend on `req.user`.

### `apps/user-api/src/middleware/roleGuard.ts`

Provides role-based authorization middleware and utilities. Defines a `ROLE_RANK` hierarchy (STUDENT=0 through SERVICE=4) and exports `roleRank()` for numeric comparison. `requireRole(...roles)` restricts access to users with any of the specified roles. `requireSelfOrRole(...roles)` additionally allows access when `req.params.id` matches the authenticated user's ID. All guards depend on `req.user` being set by `requireAuth` and return 401/403 as appropriate.

### `apps/user-api/src/middleware/validate.ts`

Exports three Express middleware factories—`validateQuery`, `validateBody`, and `validateParams`—that validate the respective request properties against a provided Zod schema. On failure, they return 400 with flattened Zod errors. `validateBody` replaces `req.body` with the parsed (and potentially transformed/stripped) data; `validateParams` similarly replaces `req.params`. These should be placed early in the middleware chain to ensure handlers receive clean, typed data.

### `apps/user-api/src/routes/user.ts`

Express router implementing CRUD endpoints for user management with role-based access control. Exports a Router with GET `/batch` (multi-user lookup, max 100 IDs), GET `/:id`, POST `/`, PATCH `/:id`, and DELETE `/:id` (soft delete via `deletedAt`). All routes require authentication via `requireAuth` middleware, with role guards (`requireRole`, `requireSelfOrRole`) enforcing hierarchical permissions using `roleRank` — users cannot create/assign roles above their own rank, and cannot delete users at or above their rank. Request validation uses Zod schemas through `validateBody`, `validateParams`, and `validateQuery` middleware. The batch route is intentionally placed before `/:id` to avoid route parameter conflicts.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints. Exports `batchQuerySchema` (for querying multiple users by comma-separated IDs), `userIdSchema` (single user ID param), `updateUserSchema` (partial update requiring at least one field with a `.refine` check), and `createUserSchema` (requires email and name, optional role). All role fields are constrained to the enum `["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN"]`. Depends on the `zod` library; when modifying, ensure enum values stay in sync with the Prisma/database role definitions.

### `docker-compose.yml`

Docker Compose configuration for local development defining two services: a PostgreSQL 16 database and the user-api application. PostgreSQL uses a named volume for data persistence and has a health check that user-api depends on before starting. The user-api service is built from the repository root using the user-api Dockerfile, with environment variables for database connection, port, and BetterAuth configuration (secret and URL sourced from `.env` or defaults). Developers should ensure BETTER_AUTH_SECRET is set in their environment or `.env` file.

### `packages/auth/src/index.ts`

Configures and exports a shared authentication setup using the `better-auth` library with a Prisma/PostgreSQL adapter from `@hallpass/db`. The `createAuth` factory function accepts a `baseURL` and `secret`, enables email/password authentication, and sets session expiry to 7 days with a 1-day update age. Exports the `Auth` and `Session` inferred types, plus `toNodeHandler` and `fromNodeHeaders` utilities for Node.js HTTP integration. This is a shared package consumed by multiple apps; changes to session config or auth settings will affect all downstream services.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema using Prisma ORM for the HallPass application. Contains a `Role` enum (STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE) and three models: `User` (with soft-delete via `deletedAt`), `Session` (token-based with IP/user-agent tracking), and `Account` (multi-provider auth with optional password). Both Session and Account cascade-delete when their parent User is removed. Uses `cuid()` for all primary keys and includes standard `createdAt`/`updatedAt` timestamps. Developers adding models or fields must run Prisma migrations to keep the database in sync.
