# Codebase Context — main

_Generated: 2026-07-14T20:12:49.025Z — 18 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a Demo UI to GitHub Pages. Triggers on pushes to `main` when Postman collections, the demo generation script, or demo-ui app files change, plus manual dispatch. Uses pnpm with Node 22, runs `pnpm demo:generate` to build static HTML, then deploys the `apps/demo-ui` directory to the `gh-pages` branch via `peaceiris/actions-gh-pages`. Requires `contents: write` permission for pushing to the gh-pages branch.

### `.github/workflows/deploy.yml`

CI/CD pipeline for a pnpm monorepo deploying three microservices (user-api, schools-api, passes-api) to Google Cloud Run, with separate dev and prod environments. The `validate` job runs linting, building, Prisma client generation, a pass index guard check, and tests on every push/PR, using dummy environment variables since tests mock the DB. Dev deploys trigger on pushes to `develop` (or manual dispatch with env=dev), while prod deploys trigger on pushes to `main` (or manual dispatch with env=prod on main). Database migrations run via `prisma migrate deploy` in isolated jobs (`migrate-dev`/`migrate-prod`), fetching connection strings from GCP Secret Manager at runtime to avoid leaking secrets. Docker images are built per-service using Buildx with GitHub Actions cache, pushed to GCP Artifact Registry, and deployed to Cloud Run with env vars/secrets managed directly on the Cloud Run service via GCP Secret Manager. Key secrets required: `GCP_SA_KEY` and `GCP_PROJECT_ID`; the SA needs `secretmanager.secretAccessor` for the relevant DATABASE_URL secrets.

### `.github/workflows/index-codebase.yml`

Automated codebase indexing workflow that generates AI context documents by running `scripts/index-codebase.ts` with the Anthropic API. Triggers on pushes to `develop`/`main` or manual dispatch with branch selection; uses a concurrency group (`docs-index`) with `cancel-in-progress: false` to serialize runs. It restores a previous manifest from the `docs/index` orphan branch to enable incremental indexing, then pushes updated docs back to that branch with `[skip ci]` commits. Requires the `ANTHROPIC_API_KEY` secret and `contents: write` permission; the branch slug is derived from the ref name to support per-branch context documents.

### `.github/workflows/review-pr.yml`

AI-powered pull request review workflow using Claude (Anthropic API) that runs on PR events targeting `develop` or `main`, or via manual dispatch with a PR number. Restricted to PRs authored by `bkoch-16` and excludes bot-triggered events. Generates a unified diff (with 20 lines of context) against the base branch, fetches the codebase context document from the `docs/index` branch, then runs `scripts/review-pr.ts` to produce a review. The review is submitted as an approval, change request, or comment based on whether the output starts with "Ship it" or "Request changes". Requires `ANTHROPIC_API_KEY` secret and `pull-requests: write` permission.

### `.github/workflows/sync-develop.yml`

Keeps the `develop` branch in sync with `main` by automatically creating a merge PR after each push to `main`. First checks if `develop` already contains all of `main`'s commits (early exit if so), then creates/updates a `sync/main-to-develop` branch with a `--no-ff` merge. On merge conflicts, it aborts and posts a conflict notification as a comment on the originating PR or commit. Uses `--force-with-lease` for safe pushes and avoids creating duplicate PRs by checking for existing open sync PRs. Requires `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Multi-stage Docker build for the user-api Express service, based on node:22-alpine with pnpm@10. Uses layer caching by copying package manifests first and running pnpm install before copying source code. Generates the Prisma client with a dummy DATABASE_URL (no DB connection needed), then builds all dependent workspace packages in dependency order. Uses a custom docker-entrypoint.sh script as ENTRYPOINT and exposes port 3001. Developers modifying this must update the COPY and build filter steps if new workspace packages are added as dependencies.

### `apps/user-api/src/app.ts`

Express application setup for the user-api service. Configures helmet, CORS, HTTP logging, JSON parsing, health check endpoint (exempt from rate limiting), and Redis-backed rate limiting with separate general and auth limiters. Routes better-auth endpoints under /api/auth/* with a strict auth limiter on credential-sensitive POST routes, and mounts the user CRUD router at /api/users. Falls back to in-memory rate limiting when Redis is unavailable or in test mode. Uses middleware from @hallpass/express-middleware throughout.

### `apps/user-api/src/auth.ts`

Configures and exports the better-auth instance for the user-api service by calling createAuth from @hallpass/auth with the shared Prisma client, base URL, secret, and parsed CORS origins as trusted origins. The wildcard '*' origin maps to undefined (better-auth requires concrete origin lists). This auth instance is imported by route handlers and middleware throughout the service.

### `apps/user-api/src/env.ts`

Validates and exports the runtime environment variables for the user-api service using the rateLimitEnvSchema from @hallpass/express-middleware (which extends the base env schema with REDIS_URL and REDIS_PREFIX). The parsed env object is the single source of truth for configuration across the service. Any new environment variables must be added to the upstream schema.

### `apps/user-api/src/index.ts`

Entry point for the user-api service. Loads dotenv, sets up global unhandledRejection and uncaughtException handlers that log and exit, then starts the Express app listening on the configured PORT (default 3001). This file should remain minimal — application setup lives in app.ts.

### `apps/user-api/src/lib/pin.ts`

Provides PIN code generation and collision-safe user creation logic for the user API. `generatePinCode()` produces a 6-digit string (100000–999999, no leading zeros) using Node's crypto `randomInt`. `createUserWithPin()` is the primary export: it wraps a user creation callback, automatically generating and assigning a pinCode for STUDENT roles while retrying up to 5 times on Prisma P2002 unique constraint violations specific to the `pinCode` field. Non-student roles receive no pin and skip retry logic. The helper `isPinCodeConflict()` distinguishes pinCode collisions from email conflicts by inspecting the P2002 error's `meta.target`, ensuring email uniqueness errors propagate unchanged to callers.

### `apps/user-api/src/middleware/auth.ts`

Exports a requireAuth Express middleware created via createRequireAuth from the shared middleware package, bound to this service's auth instance. This middleware is used on protected routes to verify the session and populate req.user.

### `apps/user-api/src/routes/user.ts`

Comprehensive Express router implementing CRUD operations for users at /api/users. Supports GET /me, cursor-paginated listing with optional role/ids filtering, GET/:id, POST (single create with temp password and pin assignment), POST /bulk (concurrent batch creation with throttled scrypt hashing), PATCH/:id, and soft DELETE/:id. Enforces role-based access control via requireRole/requireSelfOrRole, school-scoped tenancy (non-super-admins only see their school's users), and role hierarchy checks preventing privilege escalation. Uses Zod validation middleware for body/params/query and handles duplicate email errors (both EmailInUseError and Prisma P2002).

### `apps/user-api/src/schemas/user.ts`

Zod validation schemas for user-related API endpoints. Exports `userIdSchema` (validates route param as numeric string), `listUsersSchema` (role filter, cursor pagination, ids filter, limit with default 50), `createUserSchema` (email, name required, optional role from ASSIGNABLE_ROLES), `bulkCreateSchema` (array of 1-100 create schemas), and `updateUserSchema` (partial update requiring at least one field, with nullable schoolId support). All role fields are validated against ASSIGNABLE_ROLES from @hallpass/types.

### `docker-compose.yml`

Docker Compose configuration for local development defining four services: postgres (16-alpine), redis (7-alpine), user-api (port 3001), and schools-api (port 3002). Both API services depend on healthy postgres and redis containers, with DATABASE_URL and REDIS_URL wired to the internal Docker network. Environment variables like BETTER_AUTH_SECRET are expected from the host environment or .env file. A named volume 'postgres_data' persists database state across restarts.

### `package.json`

Root package.json for the 'hallpass-backend' monorepo using pnpm workspaces and Turborepo for orchestration. Defines workspace-level scripts for build, dev, lint, format, test (unit and integration), and demo generation. Dev dependencies include ESLint, Prettier, Husky (git hooks), TypeScript, and tsx for script execution. The only production dependency at root is @anthropic-ai/sdk. Notable: pnpm overrides pin ioredis to 5.10.0, and onlyBuiltDependencies restricts native builds to Prisma engines, esbuild, and prisma.

### `packages/auth/src/index.ts`

Shared authentication package wrapping better-auth with PostgreSQL/Prisma adapter and bearer token plugin. Exports createAuth factory (configuring email/password auth with signup disabled, serial ID generation, 7-day sessions, and HTTPS-aware cookie settings), the Auth and Session types, toNodeHandler/fromNodeHeaders utilities, and createUserWithCredential for server-side user provisioning with race-condition-safe duplicate email detection. EmailInUseError is exported for consistent error handling. The user model extends better-auth with role and schoolId additional fields. Developers adding user fields must update both additionalFields and createUserWithCredential.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema for the HallPass application using Prisma ORM. Core models include District, School, User (with roles: STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE), Session, Account, ScheduleType, Period, SchoolCalendar, Destination, PassPolicy, and Pass (with lifecycle statuses: PENDING, WAITING, ACTIVE, COMPLETED, CANCELLED, DENIED, EXPIRED). The Pass model has a critical partial unique index (`one_active_pass_per_student`) enforcing one active pass per student that exists only in a migration SQL file—Prisma cannot express it declaratively, so developers must manually remove any auto-generated `DROP INDEX` for it in new migrations. Soft-delete via `deletedAt` is used on most models except Pass, which relies on terminal statuses. The User model has multiple named relations to Pass (student, requester, approver, denier, canceller) and a unique `pinCode` field for student lookup. Key indexes exist on Pass for schoolId, studentId, status, and a composite (destinationId, status).
