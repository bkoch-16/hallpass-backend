# Codebase Context — develop

_Generated: 2026-07-22T19:13:07.394Z — 19 files indexed_

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

Express application setup and configuration for the user-api service. Configures middleware stack including helmet, CORS, HTTP logging, JSON parsing, health checks, and a multi-layered rate-limiting strategy (general, auth per-IP+email, and auth per-account) backed by Redis in production or in-memory in test. Auth routes under `/api/auth/*` are delegated to better-auth via `toNodeHandler`, while `/api/users` routes use a dedicated router. Rate limiting is carefully split: email-based auth routes get both an IP+email limiter and an account-level limiter (with skip-successful-requests), while password-reset gets a separate account limiter that counts all requests since the endpoint always returns 200. Relies on shared packages (`@hallpass/auth`, `@hallpass/logger`, `@hallpass/express-middleware`) and local modules (`auth`, `env`, `routes/user`). Developers modifying this file should understand the intentional ordering of middleware (health before rate limiters, auth limiters before the auth handler) and the anti-enumeration design decisions documented in comments.

### `apps/user-api/src/auth.ts`

Initializes and exports the better-auth instance for the user-api service by calling `createAuth` from `@hallpass/auth`. Configures the auth system with Prisma, base URL, secret, trusted CORS origins, and a password-reset email callback that uses the `@hallpass/email` package via SES. Trusted origins are derived from `parseCorsOrigins` and only passed as a concrete array (not wildcard). Errors during reset email sending are logged but not re-thrown, preventing auth flow disruption.

### `apps/user-api/src/email.ts`

Provides email infrastructure for the user-api service: creates an email sender (SES-backed or logging fallback) and generates password reset URLs. The `sesConfig()` function returns AWS SES configuration only when all required env vars (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM) are present; otherwise returns undefined, triggering the fallback logger sender. The `resetPasswordUrl` function constructs a reset link pointing to the web app's static HTML page with a URL-encoded token parameter. Depends on `@hallpass/email` for sender creation and `./env.ts` for validated environment variables.

### `apps/user-api/src/env.ts`

Validates and exports environment variables for the user-api service using Zod schemas. Combines `rateLimitEnvSchema` from `@hallpass/express-middleware` with a custom `emailEnvSchema` that enforces all-or-nothing SES configuration (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM must all be present or all absent). A second refinement requires WEB_APP_URL when SES is configured. The parsed and validated env object is exported directly, making it the single source of truth for environment configuration in the user-api app.

### `apps/user-api/src/index.ts`

Entry point for the user-api service that loads environment variables via dotenv, imports the Express app, and starts the HTTP server on the configured PORT (default 3001). Registers global handlers for `unhandledRejection` and `uncaughtException` that log the error and force a process exit to prevent running in an undefined state. Depends on the shared `@hallpass/logger` package and the local `env` module for configuration.

### `apps/user-api/src/lib/pin.ts`

Handles generation and collision-safe assignment of 6-digit PIN codes for student users, used by an external parent voice tool. Exports `generatePinCode()` (produces a random 6-digit string with no leading zero via `crypto.randomInt`) and `createUserWithPin<T>()` which wraps a creation callback, retrying up to 5 times on Prisma P2002 unique constraint violations specifically on the `pinCode` field. Non-STUDENT roles skip pin generation entirely (callback receives `undefined`). The `isPinCodeConflict` helper distinguishes pinCode collisions from email conflicts by inspecting Prisma error metadata, ensuring email uniqueness errors propagate unchanged.

### `apps/user-api/src/middleware/auth.ts`

Exports a `requireAuth` Express middleware created via the `createRequireAuth` factory from `@hallpass/express-middleware`, configured with the local `auth` instance. This middleware should be used on routes that need an authenticated user; it populates `req.user` on success. Changing the auth provider or configuration should be done in `../auth.js`, not here.

### `apps/user-api/src/routes/user.ts`

Express router implementing full CRUD for users with role-based access control, cursor-paginated listing, bulk creation, and soft-delete. Exports a default Router with endpoints: GET /me, GET / (list with optional ?ids= batch lookup and ?q= search), GET /:id, POST / (single create), POST /bulk (throttled concurrent creation), PATCH /:id, and DELETE /:id. User provisioning uses `createUserWithCredential` from @hallpass/auth with a server-generated temp password, assigns a student pinCode via `createUserWithPin`, and sends an invite email—both pin and email failures are logged but non-fatal to avoid rolling back committed user rows. Enforces hierarchical role authorization via `roleRank`, school-scoping for non-super-admins, and `requireSelfOrRole` for self-access paths. Soft-deletes set `deletedAt` and revoke better-auth sessions. Depends on Prisma, Zod validation middleware, and shared packages (@hallpass/auth, @hallpass/email, @hallpass/express-middleware, @hallpass/types).

### `apps/user-api/src/schemas/user.ts`

Zod validation schemas for user-related API endpoints, used with `validateBody`, `validateParams`, and `validateQuery` middleware. Exports `userIdSchema` (route param with numeric string id), `listUsersSchema` (query params: role filter, cursor pagination with configurable limit 1-100 defaulting to 50, comma-separated ids, and search query q), `createUserSchema` (email, name required; optional assignable role), `bulkCreateSchema` (array of 1-100 createUserSchema entries), and `updateUserSchema` (partial update requiring at least one field, with optional nullable schoolId). Uses `ASSIGNABLE_ROLES` from @hallpass/types to constrain role enums, ensuring only permitted roles can be specified by clients.

### `docker-compose.yml`

Defines the local development infrastructure for the HallPass application, orchestrating four services: PostgreSQL 16, Redis 7, a user-api (port 3001), and a schools-api (port 3002). Both API services depend on healthy Postgres and Redis instances and share the same database (`hallpass`) and Redis, differentiated by configuration. Environment variables include BetterAuth settings, CORS origins, Redis URL/prefix, and a `PARENT_TOOL_API_KEY` specific to schools-api; several support overrides via `${VAR:-default}` syntax. Both API Dockerfiles are built with the repo root as context (monorepo pattern), and Postgres data is persisted via a named volume (`postgres_data`). Developers modifying this file should ensure health checks remain aligned with service readiness, and note that `BETTER_AUTH_SECRET` must be provided externally (no default).

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm (v10.30.1) and Turborepo for orchestrating builds, linting, testing, and development across workspace packages. Key scripts include `build`, `dev`, `lint`, `test`, and `test:integration` (run serially), plus utility scripts for demo generation, formatting (Prettier), and a pass-index guard check. Uses Husky for git hooks, overrides ioredis to v5.10.0, and restricts native builds to @prisma/engines, esbuild, and prisma. The only production dependency at the root level is `@anthropic-ai/sdk`; all other tooling (ESLint, TypeScript, tsx, Turbo, etc.) is in devDependencies. Developers modifying this file should be aware of the pnpm overrides and onlyBuiltDependencies constraints that affect the entire workspace.

### `packages/auth/src/index.ts`

Shared authentication package wrapping better-auth with project-specific configuration for the HallPass platform. Exports createAuth() factory that configures better-auth with PostgreSQL/Prisma adapter, bearer token plugin, serial ID generation, custom session TTL (7 days), and additional user fields (role, schoolId) that are not user-settable (input: false). Sign-up is disabled (disableSignUp: true); user creation is handled exclusively through the exported createUserWithCredential() helper, which performs email uniqueness checking, password hashing, and account linking, translating race-condition P2002 errors into the exported EmailInUseError class. Also exports createSetPasswordToken() which mints better-auth-compatible reset-password verification tokens server-side, used for invite flows with configurable expiry. Key exports include the Auth and Session types, toNodeHandler/fromNodeHeaders for Express integration, and EmailInUseError. When baseURL is HTTPS, cookies are configured with sameSite:'none' and secure:true for cross-origin deployments.

### `packages/db/prisma/schema.prisma`

Defines the full PostgreSQL database schema for the HallPass application using Prisma ORM. Models include District, School, User, Session, Account, Verification (for better-auth), ScheduleType, Period, SchoolCalendar, Destination, PassPolicy, and Pass. Key enums are Role (STUDENT/TEACHER/ADMIN/SUPER_ADMIN/SERVICE), PolicyInterval, and PassStatus (lifecycle states). The schema uses integer autoincrement IDs throughout (required by better-auth's `generateId: "serial"` config), soft deletes via `deletedAt` on most models (but notably not Pass, which uses terminal statuses instead), and relational integrity via foreign keys. Critical caveat: a partial unique index `one_active_pass_per_student` exists only in a migration and not in this schema—any new migration will generate a DROP for it that must be manually removed before applying. The Pass model has multiple named relations to User (student, requester, approver, denier, canceller) and strategic composite/single-column indexes.
