# Codebase Context — develop

_Generated: 2026-07-24T16:44:52.512Z — 19 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a Demo UI to GitHub Pages. Triggers on pushes to main when Postman collections, the demo generation script, or demo-ui app files change, plus manual dispatch. Uses pnpm with Node 22, runs `pnpm demo:generate` to build static HTML, then deploys the `./apps/demo-ui` directory to the `gh-pages` branch using the peaceiris/actions-gh-pages action. Requires `contents: write` permission for pushing to gh-pages. Developers modifying this should note the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var and that the generation script path (`scripts/generate-demo.ts`) and publish directory must stay in sync.

### `.github/workflows/deploy.yml`

CI/CD workflow that validates (lint, build, test), runs Prisma DB migrations, and deploys three microservices (user-api, schools-api, passes-api) to Google Cloud Run. It triggers on pushes to `main` (prod) and `develop` (dev), on PRs (validate only), and via manual workflow_dispatch with environment selection. The `validate` job uses dummy env vars since tests mock the DB, generates the Prisma client, runs the pass-index guard, then lints/builds/tests. Migration jobs securely fetch DATABASE_URL from GCP Secret Manager within a single shell to avoid secret leakage, then run `prisma migrate deploy`. Deploy jobs use a matrix strategy with Docker Buildx and GHA caching to build/push images to Artifact Registry and deploy via `google-github-actions/deploy-cloudrun@v3`; runtime env vars and secrets are managed directly on Cloud Run services, not in this workflow. Developers should note that prod deploys require the `main` branch, and the workflow depends on `GCP_SA_KEY` and `GCP_PROJECT_ID` repository secrets.

### `.github/workflows/index-codebase.yml`

Workflow that generates an AI-powered codebase context/index document using the Anthropic API. Triggers on pushes to `develop`/`main` or manual dispatch with branch selection, and stores results on an orphan `docs/index` branch. Implements incremental indexing by restoring a previous manifest JSON before running the indexer script (`scripts/index-codebase.ts`). Uses serialized concurrency (`docs-index` group, no cancellation) and a 15-minute timeout. Developers modifying this should note the branch-slug naming convention for manifests and that the `ANTHROPIC_API_KEY` secret is required.

### `.github/workflows/review-pr.yml`

AI-powered PR review workflow using Claude (Anthropic API) that runs on PR events targeting `develop`/`main` or via manual dispatch with a PR number. Restricted to PRs authored by `bkoch-16` and excludes bot-triggered events. Generates a unified diff with 20 lines of context, fetches a codebase context document from the `docs/index` branch, then runs `scripts/review-pr.ts` to produce a review. The review action (approve, request-changes, or comment) is determined by parsing the first line of the generated `review.md`. Requires `ANTHROPIC_API_KEY` secret and `pull-requests: write` permission; sets `HUSKY=0` to skip git hooks.

### `.github/workflows/sync-develop.yml`

Automation workflow that keeps the `develop` branch in sync with `main` by creating a merge PR after each push to `main`. First checks if `develop` already contains all `main` commits (early exit if so), then creates/updates a `sync/main-to-develop` branch with a no-ff merge. On merge conflicts, it aborts and posts a conflict notification as a comment on the originating PR or commit. Uses `--force-with-lease` for safe pushes and avoids creating duplicate PRs by checking for existing open sync PRs. Requires both `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Dockerfile for the user-api service, building a Node.js 22 Alpine image with pnpm 10 in a monorepo context. It uses a layered copy strategy—manifests first, then source—to maximize Docker layer caching for dependency installation. Prisma client generation is performed with a dummy DATABASE_URL since it doesn't require a live database connection. Internal packages (@hallpass/db, auth, logger, email, types, express-middleware) are built in explicit dependency order before the user-api itself. The container exposes port 3001 and uses a custom `docker-entrypoint.sh` script as its entrypoint. When modifying, ensure any new workspace packages are added both in the manifest-copy section and the build sequence in the correct dependency order.

### `apps/user-api/src/app.ts`

Entry point for the user-api Express application. Configures and mounts rate limiters (general, auth, and account-level) with Redis-backed stores (falling back to in-memory in test or when Redis is unavailable), routes auth requests to better-auth via `toNodeHandler`, and mounts the user router at `/api/users`. Rate limiting follows a two-layer defense: per-(email, IP) auth limiter and per-email account limiter, with a special variant for password-reset that counts all requests (since the endpoint always returns 200). Depends on shared packages `@hallpass/auth`, `@hallpass/logger`, and `@hallpass/express-middleware`. Exports the configured Express app as the default export. Developers modifying this file should understand the rate-limit layering strategy and the Redis store namespacing convention (`REDIS_PREFIX:rl:user-api:<suffix>:`).

### `apps/user-api/src/auth.ts`

Configures and exports the better-auth instance for the user-api service by calling `createAuth` from `@hallpass/auth`. Wires up Prisma as the database adapter, trusted origins from env, and a `sendResetPassword` hook that sends a password-reset email using the shared `@hallpass/email` template and the service's `emailSender`. Errors during email sending are caught and logged rather than propagated. The exported `auth` object is used by both the auth route handler in `app.ts` and the user router for server-side token minting.

### `apps/user-api/src/email.ts`

Provides email infrastructure for the user-api service: creates an email sender (SES-backed or logging fallback) and generates password reset URLs. The `sesConfig()` function returns AWS SES configuration only when all required env vars (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM) are present; otherwise returns undefined, triggering the fallback logger sender. The `resetPasswordUrl` function constructs a reset link pointing to the web app's static HTML page with a URL-encoded token parameter. Depends on `@hallpass/email` for sender creation and `./env.ts` for validated environment variables.

### `apps/user-api/src/env.ts`

Validates and exports environment variables for the user-api service using Zod schemas. Combines `rateLimitEnvSchema` from `@hallpass/express-middleware` with a custom `emailEnvSchema` that enforces all-or-nothing SES configuration (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM must all be present or all absent). A second refinement requires WEB_APP_URL when SES is configured. The parsed and validated env object is exported directly, making it the single source of truth for environment configuration in the user-api app.

### `apps/user-api/src/index.ts`

Entry point for the user-api service that loads environment variables via dotenv, imports the Express app, and starts the HTTP server on the configured PORT (default 3001). Registers global handlers for `unhandledRejection` and `uncaughtException` that log the error and force a process exit to prevent running in an undefined state. Depends on the shared `@hallpass/logger` package and the local `env` module for configuration.

### `apps/user-api/src/lib/pin.ts`

Provides utilities for generating and assigning unique 6-digit PIN codes to student users. Exports `generatePinCode()` which produces a random 6-digit string (no leading zero) and `createUserWithPin<T>()` which wraps a creation callback with retry logic for PIN uniqueness collisions. Only students receive PINs; non-student roles bypass PIN generation entirely. Uses `isPrismaError` from `@hallpass/express-middleware` to distinguish pinCode unique constraint violations (P2002) from other errors like email conflicts, retrying up to 5 times on pin collisions only. Developers modifying this should be aware that the retry loop is intentionally narrow — only Prisma P2002 errors on the `pinCode` field trigger a retry.

### `apps/user-api/src/middleware/auth.ts`

Exports a `requireAuth` Express middleware created via the `createRequireAuth` factory from `@hallpass/express-middleware`, configured with the local `auth` instance. This middleware should be used on routes that need an authenticated user; it populates `req.user` on success. Changing the auth provider or configuration should be done in `../auth.js`, not here.

### `apps/user-api/src/routes/user.ts`

Defines the Express router for `/api/users` with full CRUD plus bulk creation. Exports routes: `GET /me`, `GET /` (cursor-paginated with optional `ids`, `role`, `q` filters), `GET /:id`, `POST /` (provision single user with temp password, pin assignment, and invite email), `POST /bulk` (batch user creation with concurrency-throttled scrypt hashing), `PATCH /:id`, and `DELETE /:id` (soft-delete with session revocation). Enforces role-based access control using `requireAuth`, `requireRole`, `requireSelfOrRole`, and `roleRank` with a convention that admins can create peers but cannot modify/delete users at or above their own rank. Uses Zod validation via `validateBody`/`validateParams`/`validateQuery` and shared schemas. Pin assignment and invite emails are non-fatal — failures are logged but don't block the response. The `DELETE` endpoint performs a soft-delete (`deletedAt`) and eagerly revokes better-auth sessions. Depends on `@hallpass/auth` for `createUserWithCredential` and `createSetPasswordToken`, `@hallpass/db` for Prisma, and `@hallpass/types` for response types.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related route parameters and query strings. Exports `userIdSchema` (numeric string param) and `listUsersSchema` (pagination cursor, limit with default 50, optional role/ids/q filters). Re-exports `createUserSchema`, `updateUserSchema`, and `bulkCreateSchema` directly from `@hallpass/types` to keep request body validation in sync with shared TypeScript types. Uses `ASSIGNABLE_ROLES` enum from `@hallpass/types` to constrain the role query filter.

### `docker-compose.yml`

Defines the local development infrastructure for the HallPass application, orchestrating four services: PostgreSQL 16, Redis 7, a user-api (port 3001), and a schools-api (port 3002). Both API services depend on healthy Postgres and Redis instances and share the same database (`hallpass`) and Redis, differentiated by configuration. Environment variables include BetterAuth settings, CORS origins, Redis URL/prefix, and a `PARENT_TOOL_API_KEY` specific to schools-api; several support overrides via `${VAR:-default}` syntax. Both API Dockerfiles are built with the repo root as context (monorepo pattern), and Postgres data is persisted via a named volume (`postgres_data`). Developers modifying this file should ensure health checks remain aligned with service readiness, and note that `BETTER_AUTH_SECRET` must be provided externally (no default).

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm (v10.30.1) and Turborepo for orchestrating builds, linting, testing, and development across workspace packages. Key scripts include `build`, `dev`, `lint`, `test`, and `test:integration` (run serially), plus utility scripts for demo generation, formatting (Prettier), and a pass-index guard check. Uses Husky for git hooks, overrides ioredis to v5.10.0, and restricts native builds to @prisma/engines, esbuild, and prisma. The only production dependency at the root level is `@anthropic-ai/sdk`; all other tooling (ESLint, TypeScript, tsx, Turbo, etc.) is in devDependencies. Developers modifying this file should be aware of the pnpm overrides and onlyBuiltDependencies constraints that affect the entire workspace.

### `packages/auth/src/index.ts`

Configures and exports a better-auth instance factory (`createAuth`) backed by a Prisma/PostgreSQL adapter with the bearer plugin, serial ID generation, cookie settings for HTTPS, and 7-day sessions. Extends the user model with `role` and `schoolId` additional fields; disables public sign-up (`disableSignUp: true`). Exports `createUserWithCredential` for server-side user provisioning: it hashes the password, creates a User row, links a credential Account, and rolls back the user on link failure to avoid orphaned rows — race conditions on the email unique index are translated to the exported `EmailInUseError`. `createSetPasswordToken` mints a reset-password Verification row so invite links reuse better-auth's existing reset flow. Also re-exports `toNodeHandler`, `fromNodeHeaders`, and the `Auth`/`Session` types.

### `packages/db/prisma/schema.prisma`

Defines the full PostgreSQL database schema for the HallPass application using Prisma ORM. Models include District, School, User, Session, Account, Verification (for better-auth), ScheduleType, Period, SchoolCalendar, Destination, PassPolicy, and Pass. Key enums are Role (STUDENT/TEACHER/ADMIN/SUPER_ADMIN/SERVICE), PolicyInterval, and PassStatus (lifecycle states). The schema uses integer autoincrement IDs throughout (required by better-auth's `generateId: "serial"` config), soft deletes via `deletedAt` on most models (but notably not Pass, which uses terminal statuses instead), and relational integrity via foreign keys. Critical caveat: a partial unique index `one_active_pass_per_student` exists only in a migration and not in this schema—any new migration will generate a DROP for it that must be manually removed before applying. The Pass model has multiple named relations to User (student, requester, approver, denier, canceller) and strategic composite/single-column indexes.
