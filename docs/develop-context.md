# Codebase Context — develop

_Generated: 2026-03-07T00:07:32.043Z — 20 files indexed_

## File Summaries

### `.github/workflows/demo.yml`

GitHub Actions workflow that generates and deploys a demo UI to GitHub Pages. Triggered by pushes to main/develop that modify Postman collections or the demo generation script, or via manual dispatch. Uses pnpm with Node 22 to run `pnpm demo:generate`, then deploys the `./apps/demo-ui` directory to the `gh-pages` branch using the peaceiris/actions-gh-pages action. Requires `contents: write` permission for pushing to gh-pages.

### `.github/workflows/deploy.yml`

CI/CD workflow for the backend user-api service, handling validation (lint, build, test) and deployment to Google Cloud Run. The `validate` job runs on all pushes and PRs, using dummy environment variables for DATABASE_URL, BETTER_AUTH_SECRET, and BETTER_AUTH_URL since tests mock the DB layer. Separate `deploy-dev` and `deploy-prod` jobs deploy Docker images to GCP Artifact Registry and Cloud Run, gated by branch (develop→dev, main→prod) or manual workflow_dispatch with environment selection. Environment variables and secrets on Cloud Run are managed via GCP Secret Manager, not passed in the workflow. Depends on GCP secrets (`GCP_PROJECT_ID`, `GCP_SA_KEY`) and uses Docker Buildx with GitHub Actions cache for efficient builds.

### `.github/workflows/index-codebase.yml`

Workflow that generates an AI-friendly codebase context document by running `scripts/index-codebase.ts` with an Anthropic API key. Triggered on pushes to develop/main or manually with a branch selector. It restores a previous manifest from the `docs/index` orphan branch for incremental indexing, runs the indexer, then commits updated docs back to `docs/index`. Uses concurrency group `docs-index` with `cancel-in-progress: false` to prevent parallel runs, and commits are tagged `[skip ci]` to avoid recursive triggers.

### `.github/workflows/review-pr.yml`

AI-powered PR review workflow using Claude (Anthropic API) that runs on PR events or manual dispatch. Restricted to PRs authored by `bkoch-16` and ignores bot-triggered events. It generates a diff against the PR's base branch, fetches a codebase context document from `docs/index`, and runs `scripts/review-pr.ts` to produce a review. The review output is parsed for "Ship it" (approve), "Request changes", or default (comment) actions via `gh pr review`. Requires `pull-requests: write` permission and the `ANTHROPIC_API_KEY` secret. Sets `HUSKY: 0` to skip git hooks during CI.

### `.github/workflows/sync-develop.yml`

Automation workflow that keeps the `develop` branch in sync with `main` after each push to main. It checks if develop already contains main's commits (exits early if so), then attempts a `--no-ff` merge of main into a `sync/main-to-develop` branch. On merge conflicts, it aborts and posts a conflict notification comment on the originating PR or commit. If the merge succeeds with actual differences, it force-pushes the sync branch and creates a PR targeting develop (or skips if one already exists). Requires `contents: write` and `pull-requests: write` permissions.

### `apps/user-api/Dockerfile`

Multi-stage Docker build for the user-api service in a pnpm monorepo. It copies package manifests first to optimize layer caching, then installs dependencies, copies source code, generates the Prisma client (using a dummy DATABASE_URL since generate doesn't connect), and builds packages in dependency order (@hallpass/db → auth → logger → user-api). The entrypoint is a custom shell script (docker-entrypoint.sh) that likely handles runtime setup such as database migrations. When modifying, be aware that build order matters due to inter-package dependencies, and any new workspace package consumed by user-api needs its package.json copied in the manifest stage.

### `apps/user-api/src/app.ts`

Main Express application setup for the user-api service. Configures middleware including helmet (security headers), CORS (with configurable origins from env), HTTP logging, JSON body parsing, and two rate limiters—a general 100 req/15min limit and a stricter 10 req/15min limit for auth routes. Routes include Better Auth integration at `/api/auth/*splat`, user routes at `/api/users`, and a `/health` endpoint that verifies database connectivity via Prisma. Depends on shared packages `@hallpass/auth`, `@hallpass/logger`, and `@hallpass/db`, plus local `auth`, `env`, and `userRouter` modules. Includes a 404 catch-all and a global error handler that logs errors and returns 500. The `trust proxy` setting is enabled for running behind a reverse proxy (important for rate limiting accuracy).

### `apps/user-api/src/auth.ts`

Initializes and exports the authentication instance for the user-api application by calling `createAuth` from the shared `@hallpass/auth` package. Configures auth using environment variables for the base URL, secret, and CORS trusted origins (supporting wildcard or comma-separated origins). Exports a single `auth` object consumed by other parts of the user-api. Developers modifying this file should ensure the `env` module provides the required `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `CORS_ORIGIN` variables.

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

Express middleware factory functions for validating request query parameters, body, and route params using Zod schemas. Exports `validateQuery`, `validateBody`, and `validateParams`, each accepting a `ZodSchema` and returning middleware that returns a 400 response with flattened Zod errors on validation failure. On success, the parsed (and potentially transformed/defaulted) data replaces the original `req.query`, `req.body`, or `req.params`. Note that `validateQuery` uses `Object.defineProperty` to overwrite `req.query` since it is normally read-only, while body and params are assigned directly.

### `apps/user-api/src/routes/user.ts`

Defines the Express router for all user CRUD endpoints including GET /me, GET / (cursor-paginated list with optional `ids` batch lookup), GET /:id, POST / (single create), POST /bulk (bulk create), PATCH /:id, and DELETE /:id (soft delete via `deletedAt`). Uses middleware chains of `requireAuth`, role-based guards (`requireRole`, `requireSelfOrRole`), and Zod validation (`validateBody`, `validateParams`, `validateQuery`) from sibling middleware/schema modules. Role hierarchy is enforced via `roleRank` to prevent privilege escalation on create, update, and delete operations. Depends on `@hallpass/db` for Prisma client and Role enum; all queries filter on `deletedAt: null` and select a consistent subset of user fields. Handles Prisma unique constraint errors (P2002) for email conflicts.

### `apps/user-api/src/schemas/user.ts`

Zod validation schemas for user-related API endpoints. Exports `userIdSchema` (route params), `listUsersSchema` (query params with coerced numeric limit defaulting to 50), `createUserSchema` (email, name, optional role), `bulkCreateSchema` (array of 1-100 create entries), and `updateUserSchema` (partial update requiring at least one field via `.refine`). Role values are constrained to the enum `['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN']`. These schemas are consumed by the validation middleware in the user routes.

### `docker-compose.yml`

Local development Docker Compose configuration defining two services: a PostgreSQL 16 database and the user-api application. Postgres uses a named volume for data persistence and includes a health check; the user-api service depends on Postgres being healthy before starting. Environment variables BETTER_AUTH_SECRET and BETTER_AUTH_URL are expected from the host environment (or .env file), while DATABASE_URL is hardcoded to the internal Docker network. The user-api is exposed on port 3001 and built from the monorepo root context using the Dockerfile in apps/user-api/.

### `package.json`

Root package.json for the 'hallpass-backend' monorepo, managed with pnpm (v10.30.1) and Turborepo for orchestrating build, dev, lint, test, and integration test tasks across packages. Key scripts include `demo:generate` (runs a TypeScript script via tsx) and `prepare` (sets up Husky git hooks). Dev dependencies center around ESLint, Prettier, TypeScript, and Turborepo, with `@anthropic-ai/sdk` as the sole production dependency. The `pnpm.onlyBuiltDependencies` field restricts native builds to Prisma engines, esbuild, and prisma. Developers modifying this file should be aware of the Turborepo pipeline configuration (separate `turbo.json`) and that this is a private, non-publishable workspace root.

### `packages/auth/src/index.ts`

Shared authentication package that wraps `better-auth` with a Prisma/PostgreSQL adapter using the shared `@hallpass/db` Prisma client. Exports a `createAuth` factory function that configures email/password authentication, session expiry (7 days) with daily refresh, trusted origins, and database connectivity. Also exports the `Auth` and `Session` types (inferred from the `betterAuth` return type), plus `toNodeHandler` and `fromNodeHeaders` utilities for Node.js HTTP integration. Developers should be aware that changes to session configuration, auth plugins, or the database adapter here affect all consuming applications across the monorepo.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema using Prisma ORM for the HallPass application. Contains a Role enum (STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE) and three models: User (with soft-delete via deletedAt), Session (token-based with IP/user-agent tracking), and Account (multi-provider auth support with optional password). Sessions and Accounts cascade-delete when their parent User is removed. IDs use cuid() generation. Any schema changes here require a Prisma migration and will affect the generated Prisma client used throughout the monorepo via @hallpass/db.
