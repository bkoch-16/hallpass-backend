# Codebase Context — develop

_Generated: 2026-03-11T00:15:35.933Z — 20 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a demo UI to GitHub Pages on pushes to `main` (filtered to specific paths) or manual dispatch. It installs dependencies with pnpm, runs a `pnpm demo:generate` script to produce static HTML from Postman collections, then deploys the `apps/demo-ui` directory to the `gh-pages` branch using the `peaceiris/actions-gh-pages` action. Requires `contents: write` permission for pushing to the gh-pages branch. Developers modifying Postman collections or the demo generation script should be aware this auto-deploys.

### `.github/workflows/deploy.yml`

CI/CD pipeline that validates (lint, build, test) on all pushes and PRs, then conditionally deploys the user-api to Google Cloud Run. The `validate` job uses dummy environment variables since tests mock the DB layer but env.ts validation still runs. Deployment follows a branch-based strategy: `develop` branch deploys to `user-api-dev` and `main` deploys to production `user-api`, both in `us-west1`. Docker images are built with Buildx, pushed to GCP Artifact Registry with SHA and `latest` tags, and use GitHub Actions cache. Secrets (GCP_PROJECT_ID, GCP_SA_KEY) must be configured in GitHub, while runtime env vars and secrets are managed directly on Cloud Run via GCP Secret Manager rather than being passed in the workflow.

### `.github/workflows/index-codebase.yml`

Workflow that generates an AI-friendly codebase context document by running `scripts/index-codebase.ts` with an Anthropic API key. Triggered on pushes to develop/main or manually with a branch selector. It restores a previous manifest from the `docs/index` orphan branch for incremental indexing, runs the indexer, then commits updated docs back to `docs/index`. Uses concurrency group `docs-index` with `cancel-in-progress: false` to prevent parallel runs, and commits are tagged `[skip ci]` to avoid recursive triggers.

### `.github/workflows/review-pr.yml`

GitHub Actions workflow that performs automated AI-powered PR reviews using Claude (Anthropic API). Triggers on PR open/sync/reopen against `develop` or `main` branches, or via manual `workflow_dispatch` with a PR number input, but only runs for the user `bkoch-16`. It checks out the code, generates a unified diff (with 20 lines of context) against the base branch, fetches an optional context doc from a `docs/index` branch, then runs `scripts/review-pr.ts` to produce a review. The review is submitted as an approval, change request, or comment based on whether the output starts with 'Ship it' or 'Request changes'. Sets `HUSKY=0` to skip git hooks during CI and requires `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` secrets.

### `.github/workflows/sync-develop.yml`

Automation workflow that keeps the `develop` branch in sync with `main` after each push to main. It checks if develop already contains main's commits (exits early if so), then attempts a `--no-ff` merge of main into a `sync/main-to-develop` branch. On merge conflicts, it aborts and posts a conflict notification comment on the originating PR or commit. If the merge succeeds with actual differences, it force-pushes the sync branch and creates a PR targeting develop (or skips if one already exists). Requires `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Dockerfile for the `user-api` service, building a Node.js 22 Alpine image with pnpm 10 in a monorepo context. It employs a layer-caching strategy by copying package manifests first, running `pnpm install --frozen-lockfile`, and then copying source code. After installation, it generates the Prisma client (using a dummy `DATABASE_URL` since generation doesn't require a live database) and builds internal packages (`db`, `auth`, `logger`, `types`) in dependency order before building `user-api` itself. The container exposes port 3001 and uses a custom `docker-entrypoint.sh` script as its entrypoint. Developers modifying this file should ensure any new workspace dependencies are added to the manifest-copy stage and the build order, and should be aware that changes to the entrypoint script require it to be kept in sync at `apps/user-api/docker-entrypoint.sh`.

### `apps/user-api/src/app.ts`

Main Express application setup for the user-api service. Configures middleware including helmet (security headers), CORS (with configurable origins from env), HTTP logging, JSON body parsing, and two rate limiters—a general 100 req/15min limit and a stricter 10 req/15min limit for auth routes. Routes include Better Auth integration at `/api/auth/*splat`, user routes at `/api/users`, and a `/health` endpoint that verifies database connectivity via Prisma. Depends on shared packages `@hallpass/auth`, `@hallpass/logger`, and `@hallpass/db`, plus local `auth`, `env`, and `userRouter` modules. Includes a 404 catch-all and a global error handler that logs errors and returns 500. The `trust proxy` setting is enabled for running behind a reverse proxy (important for rate limiting accuracy).

### `apps/user-api/src/auth.ts`

Initializes and exports the authentication instance for the user-api application by calling `createAuth` from the shared `@hallpass/auth` package. Configures auth using environment variables for the base URL, secret, and CORS trusted origins (supporting wildcard or comma-separated origins). Exports a single `auth` object consumed by other parts of the user-api. Developers modifying this file should ensure the `env` module provides the required `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `CORS_ORIGIN` variables.

### `apps/user-api/src/env.ts`

Validates and exports required environment variables at application startup using Zod schema parsing. Requires `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `CORS_ORIGIN` as mandatory strings, with `PORT` being optional. The module eagerly parses `process.env` on import, meaning the application will crash immediately if any required variable is missing. This is imported across the app for type-safe env access. CI pipelines must provide dummy values for these variables even when the database isn't used, as noted in the deploy workflow.

### `apps/user-api/src/express.d.ts`

Augments the global Express `Request` interface to include an optional `user` property, representing the authenticated user attached by the auth middleware. The user type mirrors key fields from the Prisma User model, with the `role` field typed as `UserRole` from `@hallpass/types`. This declaration enables type-safe access to `req.user` throughout all route handlers and middleware without explicit casting.

### `apps/user-api/src/index.ts`

Entry point for the user-api service. Loads environment variables via dotenv/config, imports the validated env config, and starts the Express app on the configured PORT (defaulting to 3001). Registers global handlers for unhandledRejection and uncaughtException that log the error and force process exit, ensuring the process manager can restart the service on fatal errors.

### `apps/user-api/src/middleware/auth.ts`

Express middleware that authenticates incoming requests by extracting the session via `better-auth`'s `getSession` API using converted Node headers. It validates the session exists, ensures the user ID is a valid positive integer, fetches the non-soft-deleted user from the database via Prisma, and attaches it to `req.user`. Returns 401 Unauthorized at any validation failure. Depends on `@hallpass/auth` for session resolution and `@hallpass/db` for user lookup.

### `apps/user-api/src/middleware/roleGuard.ts`

Provides role-based authorization middleware for Express routes. Exports `requireRole(...roles)` which checks that `req.user.role` is in the allowed list (403 if not), and `requireSelfOrRole(...roles)` which additionally permits access if `req.params.id` matches the authenticated user's ID. Also exports a `roleRank` helper that maps UserRole values to numeric hierarchy levels (STUDENT=0 through SERVICE=4), used elsewhere for privilege escalation checks. Assumes `requireAuth` has already run to populate `req.user`.

### `apps/user-api/src/middleware/validate.ts`

Express middleware factory functions for validating request query parameters, body, and route params using Zod schemas. Exports `validateQuery`, `validateBody`, and `validateParams`, each accepting a `ZodSchema` and returning middleware that returns a 400 response with flattened Zod errors on validation failure. On success, the parsed (and potentially transformed/defaulted) data replaces the original `req.query`, `req.body`, or `req.params`. Note that `validateQuery` uses `Object.defineProperty` to overwrite `req.query` since it is normally read-only, while body and params are assigned directly.

### `apps/user-api/src/routes/user.ts`

Implements the full CRUD REST API for users as an Express Router. Endpoints include GET /me, GET / (cursor-paginated list with optional `ids` batch filter), GET /:id, POST / (single create), POST /bulk (batch create up to 100), PATCH /:id, and DELETE /:id (soft-delete). Enforces multi-tenant school scoping—non-SUPER_ADMIN users can only access/modify users within their own school. Uses `roleRank` to prevent privilege escalation on create/update/delete. Handles Prisma error codes P2002 (unique conflict) and P2003 (FK violation). Returns typed responses conforming to `UserResponse`, `CursorPage`, and `BulkUserResult` from `@hallpass/types`.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints. Exports `userIdSchema` (path param), `listUsersSchema` (query params with cursor pagination, optional role filter, and comma-separated ids), `createUserSchema` (email, name, optional role), `bulkCreateSchema` (array of 1-100 create schemas), and `updateUserSchema` (partial update requiring at least one field, with nullable schoolId). Role fields are constrained to `ASSIGNABLE_ROLES` from `@hallpass/types`. The `limit` field uses `z.coerce.number()` for query string parsing with a default of 50.

### `docker-compose.yml`

Defines the local development environment with two services: a PostgreSQL 16 database and the user-api application. PostgreSQL is configured with default credentials (postgres/postgres), a `hallpass` database, persistent volume storage, and a health check. The user-api service is built from `apps/user-api/Dockerfile` with the repo root as build context, exposes port 3001, and depends on a healthy Postgres instance. Environment variables like `BETTER_AUTH_SECRET` are expected from the host environment or `.env` file, while others have sensible defaults. Developers should ensure the `.env` file provides `BETTER_AUTH_SECRET` before running `docker compose up`.

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm (v10.30.1) and Turborepo for orchestrating build, dev, lint, test, and integration test tasks across packages. Key scripts include `demo:generate` (runs a TypeScript script via tsx) and `prepare` (sets up Husky git hooks). Dev dependencies center around ESLint, Prettier, TypeScript, and Turborepo, with `@anthropic-ai/sdk` as the sole production dependency. The `pnpm.onlyBuiltDependencies` field restricts native builds to Prisma engines, esbuild, and prisma. Developers modifying this file should be aware of the Turborepo pipeline configuration (separate `turbo.json`) and that this is a private, non-publishable workspace root.

### `packages/auth/src/index.ts`

Factory module that creates and configures a `better-auth` authentication instance. The `createAuth` function accepts baseURL, secret, and optional trustedOrigins, wiring up the Prisma adapter with PostgreSQL and enabling email/password authentication. Uses serial (autoincrement) ID generation to match the Prisma schema. Configures secure cookie attributes (SameSite=none, Secure) for HTTPS deployments and sets session expiry to 7 days with a 1-day refresh age. Exports the `Auth` and `Session` inferred types plus `toNodeHandler` and `fromNodeHeaders` utilities for Express integration.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema for the HallPass application using Prisma ORM. Contains models for a school district hierarchy (District → School → User) along with auth-related models (Session, Account). Users have a Role enum (STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE) and soft-delete support via nullable `deletedAt` fields on District, School, and User. Sessions and Accounts cascade-delete when their parent User is removed. IDs use autoincrement integers for domain models and CUIDs for auth models (Session, Account).
