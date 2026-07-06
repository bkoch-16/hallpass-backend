# Codebase Context — develop

_Generated: 2026-07-06T18:02:26.826Z — 20 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a Demo UI to GitHub Pages. Triggers on pushes to main when Postman collections, the demo generation script, or demo-ui app files change, plus manual dispatch. Uses pnpm with Node 22, runs `pnpm demo:generate` to build static HTML, then deploys the `./apps/demo-ui` directory to the `gh-pages` branch using the peaceiris/actions-gh-pages action. Requires `contents: write` permission for pushing to gh-pages. Developers modifying this should note the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var and that the generation script path (`scripts/generate-demo.ts`) and publish directory must stay in sync.

### `.github/workflows/deploy.yml`

CI/CD pipeline triggered on pushes to main/develop, PRs, and manual dispatch with environment selection. The 'validate' job runs lint, build, and test with dummy environment variables and Prisma client generation on Node 22 with pnpm. Deploy jobs use a matrix strategy across three services (user-api, schools-api, passes-api), building Docker images with Buildx/GHA caching and pushing to Google Artifact Registry. Dev deploys trigger from the develop branch, prod deploys from main only. Environment variables and secrets are managed directly on Cloud Run via GCP Secret Manager rather than being passed in the workflow.

### `.github/workflows/index-codebase.yml`

Workflow that generates an AI-powered codebase context/index document using the Anthropic API. Triggers on pushes to `develop`/`main` or manual dispatch with branch selection, and stores results on an orphan `docs/index` branch. Implements incremental indexing by restoring a previous manifest JSON before running the indexer script (`scripts/index-codebase.ts`). Uses serialized concurrency (`docs-index` group, no cancellation) and a 15-minute timeout. Developers modifying this should note the branch-slug naming convention for manifests and that the `ANTHROPIC_API_KEY` secret is required.

### `.github/workflows/review-pr.yml`

AI-powered PR review workflow using Claude (Anthropic API) that runs on PR events targeting `develop`/`main` or via manual dispatch with a PR number. Restricted to PRs authored by `bkoch-16` and excludes bot-triggered events. Generates a unified diff with 20 lines of context, fetches a codebase context document from the `docs/index` branch, then runs `scripts/review-pr.ts` to produce a review. The review action (approve, request-changes, or comment) is determined by parsing the first line of the generated `review.md`. Requires `ANTHROPIC_API_KEY` secret and `pull-requests: write` permission; sets `HUSKY=0` to skip git hooks.

### `.github/workflows/sync-develop.yml`

Automation workflow that keeps the `develop` branch in sync with `main` by creating a merge PR after each push to `main`. First checks if `develop` already contains all `main` commits (early exit if so), then creates/updates a `sync/main-to-develop` branch with a no-ff merge. On merge conflicts, it aborts and posts a conflict notification as a comment on the originating PR or commit. Uses `--force-with-lease` for safe pushes and avoids creating duplicate PRs by checking for existing open sync PRs. Requires both `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Dockerfile for the `user-api` service, building a Node.js 22 Alpine image with pnpm 10 in a monorepo context. It employs a layer-caching strategy by copying package manifests first, running `pnpm install --frozen-lockfile`, and then copying source code. After installation, it generates the Prisma client (using a dummy `DATABASE_URL` since generation doesn't require a live database) and builds internal packages (`db`, `auth`, `logger`, `types`) in dependency order before building `user-api` itself. The container exposes port 3001 and uses a custom `docker-entrypoint.sh` script as its entrypoint. Developers modifying this file should ensure any new workspace dependencies are added to the manifest-copy stage and the build order, and should be aware that changes to the entrypoint script require it to be kept in sync at `apps/user-api/docker-entrypoint.sh`.

### `apps/user-api/src/app.ts`

Express application setup for the user-api microservice, configuring security middleware (helmet, CORS, rate limiting), health check endpoint with Prisma DB connectivity test, and route mounting. Auth routes are delegated to better-auth via toNodeHandler with a stricter rate limit (10 req/15min), while general routes get 100 req/15min. The /api/users routes are handled by the userRouter, and fallback handlers return 404/500 JSON responses. Trust proxy is set to 1 for Cloud Run deployment behind a load balancer.

### `apps/user-api/src/auth.ts`

Thin wrapper that creates and exports the better-auth instance using createAuth from @hallpass/auth, configured with the base URL, secret, and trusted origins parsed from environment variables. Trusted origins are set to undefined (permissive) when CORS_ORIGIN is '*', otherwise split from a comma-separated string.

### `apps/user-api/src/env.ts`

Environment variable validation module using Zod schema. Requires DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET, and CORS_ORIGIN as non-empty strings, with PORT as optional. The validated env object is exported and used throughout the user-api app; the module will throw at import time if required variables are missing.

### `apps/user-api/src/express.d.ts`

Augments the global Express `Request` interface to include an optional `user` property, representing the authenticated user attached by the auth middleware. The user type mirrors key fields from the Prisma User model, with the `role` field typed as `UserRole` from `@hallpass/types`. This declaration enables type-safe access to `req.user` throughout all route handlers and middleware without explicit casting.

### `apps/user-api/src/index.ts`

Entry point for the user-api service that loads dotenv, validates environment variables (via env.ts import), and starts the Express server on the configured PORT (default 3001). Registers global handlers for unhandledRejection and uncaughtException that log and exit with code 1 to ensure clean restarts in containerized environments.

### `apps/user-api/src/middleware/auth.ts`

Authentication middleware (requireAuth) that validates the session using better-auth's getSession API with converted Node headers. It verifies the session exists, the user ID is a valid positive integer, and the user record exists in the database (not soft-deleted). On success, it attaches the full user object to req.user; on any failure, it returns 401 Unauthorized.

### `apps/user-api/src/middleware/roleGuard.ts`

Provides role-based authorization middleware for Express routes. Exports `requireRole(...roles)` which checks that `req.user.role` is in the allowed list (403 if not), and `requireSelfOrRole(...roles)` which additionally permits access if `req.params.id` matches the authenticated user's ID. Also exports a `roleRank` helper that maps UserRole values to numeric hierarchy levels (STUDENT=0 through SERVICE=4), used elsewhere for privilege escalation checks. Assumes `requireAuth` has already run to populate `req.user`.

### `apps/user-api/src/middleware/validate.ts`

Express middleware factory functions for validating request query parameters, body, and route params using Zod schemas. Exports `validateQuery`, `validateBody`, and `validateParams`, each accepting a `ZodSchema` and returning middleware that returns a 400 response with flattened Zod errors on validation failure. On success, the parsed (and potentially transformed/defaulted) data replaces the original `req.query`, `req.body`, or `req.params`. Note that `validateQuery` uses `Object.defineProperty` to overwrite `req.query` since it is normally read-only, while body and params are assigned directly.

### `apps/user-api/src/routes/user.ts`

Comprehensive CRUD router for user management with cursor-based pagination, bulk creation, and role-based access control. Exports an Express Router mounted at /api/users with endpoints: GET /me, GET / (list with optional ?ids= batch lookup), GET /:id, POST / (create), POST /bulk, PATCH /:id, DELETE /:id (soft-delete). Access is controlled via requireAuth, requireRole, and requireSelfOrRole middleware, with role hierarchy enforcement via roleRank preventing privilege escalation. All queries are school-scoped unless the caller is SUPER_ADMIN, and responses conform to UserResponse/CursorPage/BulkUserResult types from @hallpass/types.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints. Exports `userIdSchema` (path param), `listUsersSchema` (query params with cursor pagination, optional role filter, and comma-separated ids), `createUserSchema` (email, name, optional role), `bulkCreateSchema` (array of 1-100 create schemas), and `updateUserSchema` (partial update requiring at least one field, with nullable schoolId). Role fields are constrained to `ASSIGNABLE_ROLES` from `@hallpass/types`. The `limit` field uses `z.coerce.number()` for query string parsing with a default of 50.

### `docker-compose.yml`

Docker Compose configuration defining three services for local development: a PostgreSQL 16 (Alpine) database, and two API microservices (user-api on port 3001, schools-api on port 3002). Both APIs depend on Postgres with a health check ensuring the database is ready before they start. Environment variables include DATABASE_URL (pointing to the containerized Postgres), BETTER_AUTH_SECRET/URL for authentication, and CORS_ORIGIN for frontend access. Each API service builds from its own Dockerfile in the apps/ directory using the repo root as build context. A named volume `postgres_data` persists database data across container restarts. Developers need to set BETTER_AUTH_SECRET (and optionally BETTER_AUTH_URL/CORS_ORIGIN) via environment or .env file.

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm 10.30.1 and Turborepo for orchestrating build, dev, lint, test, and integration test tasks across workspaces. Scripts include demo generation (via tsx), formatting (Prettier), and git hooks (Husky). The pnpm config pins ioredis to 5.10.0 via overrides and restricts native builds to Prisma engines, esbuild, and prisma. Dev dependencies cover linting (ESLint + typescript-eslint + prettier), build tooling (TypeScript, tsx, turbo), and scripting utilities (fast-glob, micromatch, yaml). The only runtime dependency at root level is @anthropic-ai/sdk.

### `packages/auth/src/index.ts`

This file is the central authentication configuration module for the project, responsible for creating and exporting a `betterAuth` instance. It exports `createAuth`, a factory function that configures BetterAuth with a Prisma/PostgreSQL adapter (using the shared `@hallpass/db` prisma client), the `bearer` plugin, email/password authentication, serial ID generation, and session settings (7-day expiry, 1-day update age). When the `baseURL` is HTTPS, it automatically sets `sameSite: 'none'` and `secure: true` on cookies for cross-origin support. Key exports include the `Auth` and `Session` types (inferred from the auth instance), plus `toNodeHandler` and `fromNodeHeaders` re-exported from `better-auth/node` for HTTP integration. Developers modifying this file should be aware that changes here affect all authentication behavior across the monorepo, and the Prisma adapter depends on the `@hallpass/db` package's schema being in sync.

### `packages/db/prisma/schema.prisma`

Defines the full PostgreSQL data model for the HallPass system using Prisma ORM, covering districts, schools, users (with Role enum), sessions, accounts, schedule types, periods, school calendars, destinations, pass policies, and passes (with PassStatus enum lifecycle). Key relationships include school-scoped users, multi-relation user-to-pass links (student, requester, approver, denier, canceller), and a one-to-one PassPolicy per school. The Pass model has a critical WARNING comment: a partial unique index (one_active_pass_per_student) exists only in a migration and not in the schema, so developers must manually remove any auto-generated DROP INDEX statements in new migrations. Passes intentionally lack a deletedAt field—they use terminal statuses instead of soft deletion. Indexes are defined on frequently queried foreign keys and status fields for pass lookups.
