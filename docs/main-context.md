# Codebase Context — main

_Generated: 2026-07-14T16:57:38.371Z — 21 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a Demo UI to GitHub Pages. Triggers on pushes to `main` when Postman collections, the demo generation script, or demo-ui app files change, plus manual dispatch. Uses pnpm with Node 22, runs `pnpm demo:generate` to build static HTML, then deploys the `apps/demo-ui` directory to the `gh-pages` branch via `peaceiris/actions-gh-pages`. Requires `contents: write` permission for pushing to the gh-pages branch.

### `.github/workflows/deploy.yml`

GitHub Actions CI/CD workflow that runs on pushes to main/develop, PRs, and manual dispatch with environment selection. The 'validate' job runs lint, build, and test with dummy env vars on Ubuntu with Node 22 and pnpm, including Prisma client generation. The 'deploy-dev' job deploys to Cloud Run on develop branch pushes or manual dev dispatch, while 'deploy-prod' deploys on main branch pushes or manual prod dispatch (restricted to main). Both deploy jobs use a matrix strategy across user-api, schools-api, and passes-api services, building Docker images with Buildx (GHA cache), pushing to GCP Artifact Registry, and deploying to Cloud Run in us-west1. Environment variables and secrets are managed via GCP Secret Manager on the Cloud Run services directly.

### `.github/workflows/index-codebase.yml`

Automated codebase indexing workflow that generates AI context documents by running `scripts/index-codebase.ts` with the Anthropic API. Triggers on pushes to `develop`/`main` or manual dispatch with branch selection; uses a concurrency group (`docs-index`) with `cancel-in-progress: false` to serialize runs. It restores a previous manifest from the `docs/index` orphan branch to enable incremental indexing, then pushes updated docs back to that branch with `[skip ci]` commits. Requires the `ANTHROPIC_API_KEY` secret and `contents: write` permission; the branch slug is derived from the ref name to support per-branch context documents.

### `.github/workflows/review-pr.yml`

AI-powered pull request review workflow using Claude (Anthropic API) that runs on PR events targeting `develop` or `main`, or via manual dispatch with a PR number. Restricted to PRs authored by `bkoch-16` and excludes bot-triggered events. Generates a unified diff (with 20 lines of context) against the base branch, fetches the codebase context document from the `docs/index` branch, then runs `scripts/review-pr.ts` to produce a review. The review is submitted as an approval, change request, or comment based on whether the output starts with "Ship it" or "Request changes". Requires `ANTHROPIC_API_KEY` secret and `pull-requests: write` permission.

### `.github/workflows/sync-develop.yml`

Keeps the `develop` branch in sync with `main` by automatically creating a merge PR after each push to `main`. First checks if `develop` already contains all of `main`'s commits (early exit if so), then creates/updates a `sync/main-to-develop` branch with a `--no-ff` merge. On merge conflicts, it aborts and posts a conflict notification as a comment on the originating PR or commit. Uses `--force-with-lease` for safe pushes and avoids creating duplicate PRs by checking for existing open sync PRs. Requires `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Multi-stage-style Dockerfile for the user-api Express service, based on node:22-alpine with pnpm@10. It copies package manifests first for Docker layer caching, runs `pnpm install --frozen-lockfile`, then copies source code and generates the Prisma client with a dummy DATABASE_URL. Builds all dependent workspace packages (@hallpass/db, auth, logger, types) before building the user-api itself. Uses a custom docker-entrypoint.sh script and exposes port 3001.

### `apps/user-api/src/app.ts`

Sets up the Express application for the user-api microservice, configuring helmet, CORS (supporting wildcard or comma-separated origins), HTTP logging, JSON parsing, and rate limiting (100 req/15min general, 10 req/15min for auth). Exposes a /health endpoint (with Prisma DB check) before rate limiting, delegates /api/auth/* to Better Auth via toNodeHandler, and mounts user routes at /api/users. Includes a 404 catch-all and a global error handler that logs and returns 500. Trust proxy is set to 1 for deployment behind a load balancer.

### `apps/user-api/src/auth.ts`

Creates and exports the Better Auth instance for the user-api service by calling createAuth from the @hallpass/auth package. Configured with baseURL, secret, and trustedOrigins derived from environment variables. When CORS_ORIGIN is '*', trustedOrigins is set to undefined (unrestricted).

### `apps/user-api/src/env.ts`

Validates and exports environment variables for the user-api service using Zod schema parsing. Required variables are DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET, and CORS_ORIGIN (all non-empty strings). PORT is optional. The module eagerly validates at import time, causing the process to fail fast on missing or invalid configuration.

### `apps/user-api/src/express.d.ts`

TypeScript declaration file that augments the Express `Request` interface to include an optional `user` property. The user object contains id, email, name, emailVerified, role (using the UserRole type from @hallpass/types), schoolId, createdAt, and updatedAt fields. This enables type-safe access to `req.user` throughout the user-api middleware and route handlers after authentication.

### `apps/user-api/src/index.ts`

Entry point for the user-api service that loads dotenv, imports the validated env config and Express app, then starts listening on the configured PORT (default 3001). Registers global handlers for unhandledRejection and uncaughtException that log and exit with code 1 to ensure the process crashes cleanly on fatal errors.

### `apps/user-api/src/lib/pin.ts`

Provides PIN code generation and collision-safe user creation logic for the user API. `generatePinCode()` produces a 6-digit string (100000–999999, no leading zeros) using Node's crypto `randomInt`. `createUserWithPin()` is the primary export: it wraps a user creation callback, automatically generating and assigning a pinCode for STUDENT roles while retrying up to 5 times on Prisma P2002 unique constraint violations specific to the `pinCode` field. Non-student roles receive no pin and skip retry logic. The helper `isPinCodeConflict()` distinguishes pinCode collisions from email conflicts by inspecting the P2002 error's `meta.target`, ensuring email uniqueness errors propagate unchanged to callers.

### `apps/user-api/src/middleware/auth.ts`

Exports the requireAuth Express middleware that validates the user's session via Better Auth's getSession API using fromNodeHeaders. After session validation, it looks up the user in Prisma (excluding soft-deleted users) and attaches the full user record to req.user. Returns 401 for any authentication failure (missing session, invalid user ID, deleted user). Depends on the auth instance from ../auth.js and the shared Prisma client.

### `apps/user-api/src/middleware/roleGuard.ts`

Express middleware factories for role-based access control. Exports `requireRole(...roles)` which checks if `req.user.role` is in the allowed list, and `requireSelfOrRole(...roles)` which additionally permits access if the request's `:id` param matches the authenticated user's ID. Also exports a `roleRank` function that maps UserRole to a numeric hierarchy (STUDENT=0 through SERVICE=4), used elsewhere for privilege escalation checks.

### `apps/user-api/src/middleware/validate.ts`

Express middleware factory functions for validating request query parameters, body, and URL params using Zod schemas. Exports `validateQuery`, `validateBody`, and `validateParams`, each returning middleware that responds with 400 and flattened Zod errors on validation failure, or replaces the relevant `req` property with the parsed (and potentially coerced/defaulted) data on success. Note that `validateQuery` uses `Object.defineProperty` to overwrite `req.query` since it's normally read-only in Express.

### `apps/user-api/src/routes/user.ts`

Express router implementing full CRUD for users with role-based access control and cursor pagination. Endpoints include GET /me, GET / (list with optional `ids` batch lookup, role filter, cursor pagination), GET /:id, POST / (single create), POST /bulk (batch create with partial-failure reporting via `Promise.allSettled`), PATCH /:id, and DELETE /:id (soft-delete via `deletedAt`). Authorization is layered: `requireAuth` for all routes, `requireRole`/`requireSelfOrRole` for elevated operations, and `roleRank` comparisons prevent privilege escalation (users cannot create/modify/delete users of equal or higher rank). SUPER_ADMIN bypasses school scoping; all other roles are constrained to their own `schoolId`. User creation delegates to `createUserWithPin` for automatic student PIN assignment, and Prisma error codes P2002/P2003 are mapped to 409/400 HTTP responses. The `USER_SELECT` constant ensures sensitive fields (password, pinCode) are never returned.

### `apps/user-api/src/schemas/user.ts`

Zod validation schemas for user-related API endpoints. Exports `userIdSchema` (validates route param as numeric string), `listUsersSchema` (role filter, cursor pagination, ids filter, limit with default 50), `createUserSchema` (email, name required, optional role from ASSIGNABLE_ROLES), `bulkCreateSchema` (array of 1-100 create schemas), and `updateUserSchema` (partial update requiring at least one field, with nullable schoolId support). All role fields are validated against ASSIGNABLE_ROLES from @hallpass/types.

### `docker-compose.yml`

Docker Compose configuration defining three services: postgres (PostgreSQL 16 with health checks and persistent volume), user-api (port 3001), and schools-api (port 3002). Both API services depend on postgres being healthy and share the same DATABASE_URL pattern pointing to the postgres service. Environment variables like BETTER_AUTH_SECRET, BETTER_AUTH_URL, and CORS_ORIGIN are configurable via .env with sensible defaults for local development.

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm (v10.30.1) and Turborepo for orchestrating build, dev, lint, test, and integration test tasks across packages. Scripts include formatting via Prettier, Husky for git hooks, and a demo generation script using tsx. The pnpm config pins ioredis to 5.10.0 via overrides and restricts native builds to @prisma/engines, esbuild, and prisma. Dev dependencies include ESLint with TypeScript support, fast-glob, micromatch, and yaml for tooling scripts. The sole runtime dependency at root level is @anthropic-ai/sdk.

### `packages/auth/src/index.ts`

This file is the central authentication configuration module for the project, responsible for creating and exporting a `betterAuth` instance. The main export is `createAuth`, a factory function that accepts a config object (`baseURL`, `secret`, `trustedOrigins`) and returns a configured Better Auth instance using the Prisma adapter with PostgreSQL and the `bearer` plugin. It enables email/password authentication, uses serial ID generation, and conditionally sets secure/sameSite cookie attributes for HTTPS origins. Session configuration is set to expire in 7 days with a 1-day update age. Key type exports include `Auth` (the return type of `createAuth`) and `Session` (inferred session type from Better Auth). It also re-exports `toNodeHandler` and `fromNodeHeaders` from `better-auth/node` for use in Node.js HTTP server integrations, and depends on `@hallpass/db` for the shared Prisma client.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema for the HallPass application using Prisma ORM. Core models include District, School, User (with roles: STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE), Session, Account, ScheduleType, Period, SchoolCalendar, Destination, PassPolicy, and Pass (with lifecycle statuses: PENDING, WAITING, ACTIVE, COMPLETED, CANCELLED, DENIED, EXPIRED). The Pass model has a critical partial unique index (`one_active_pass_per_student`) enforcing one active pass per student that exists only in a migration SQL file—Prisma cannot express it declaratively, so developers must manually remove any auto-generated `DROP INDEX` for it in new migrations. Soft-delete via `deletedAt` is used on most models except Pass, which relies on terminal statuses. The User model has multiple named relations to Pass (student, requester, approver, denier, canceller) and a unique `pinCode` field for student lookup. Key indexes exist on Pass for schoolId, studentId, status, and a composite (destinationId, status).
