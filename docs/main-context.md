# Codebase Context — main

_Generated: 2026-03-04T22:12:03.699Z — 12 files indexed_

## File Summaries

### `apps/user-api/src/app.ts`

Configures and exports the main Express application for the user-api service. Sets up security middleware (helmet, CORS, rate limiting) and logging (morgan), with a stricter rate limiter (10 req/15min) on auth routes. Routes auth requests (`/api/auth/*`) through Better Auth's Node handler, mounts the user router at `/api/users`, and provides a `/health` endpoint. Includes a 404 catch-all and a global error handler. Note the TODO for configuring CORS origin per environment; `trust proxy` is enabled for correct client IP detection behind proxies.

### `apps/user-api/src/auth.ts`

Creates and exports the Better Auth instance used throughout the user-api service. Delegates to `createAuth` from the `@hallpass/auth` package, configured with `baseURL` and `secret` from validated environment variables. This is the single auth instance imported by both the auth route handler in `app.ts` and the `requireAuth` middleware.

### `apps/user-api/src/env.ts`

Validates and exports environment variables using a Zod schema, ensuring `DATABASE_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET` are present at startup. `PORT` is optional. Parsing `process.env` through Zod provides fail-fast behavior if required variables are missing. Any new environment variables needed by the service must be added to `envSchema`.

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

Defines the Express router for CRUD user operations mounted at `/api/users`. Supports: GET `/batch` (bulk lookup by IDs, max 100, teacher+ access), GET `/:id` (self or teacher+), POST `/` (admin+ create with role escalation guard), PATCH `/:id` (self or admin+ update with role escalation guard), and DELETE `/:id` (soft-delete, admin+ only, cannot delete equal or higher rank). All routes require authentication and use Zod validation schemas. Uses Prisma for database access with soft-delete filtering (`deletedAt: null`) and consistent `select` projections. Route ordering matters—`/batch` is registered before `/:id` to avoid parameter capture conflicts.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints. Exports `batchQuerySchema` (for querying multiple users by comma-separated IDs), `userIdSchema` (single user ID param), `updateUserSchema` (partial update requiring at least one field with a `.refine` check), and `createUserSchema` (requires email and name, optional role). All role fields are constrained to the enum `["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN"]`. Depends on the `zod` library; when modifying, ensure enum values stay in sync with the Prisma/database role definitions.

### `packages/auth/src/index.ts`

Configures and exports a shared authentication setup using the `better-auth` library with a Prisma/PostgreSQL adapter from `@hallpass/db`. The `createAuth` factory function accepts a `baseURL` and `secret`, enables email/password authentication, and sets session expiry to 7 days with a 1-day update age. Exports the `Auth` and `Session` inferred types, plus `toNodeHandler` and `fromNodeHeaders` utilities for Node.js HTTP integration. This is a shared package consumed by multiple apps; changes to session config or auth settings will affect all downstream services.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema using Prisma ORM for the HallPass application. Contains a `Role` enum (STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE) and three models: `User` (with soft-delete via `deletedAt`), `Session` (token-based with IP/user-agent tracking), and `Account` (multi-provider auth with optional password). Both Session and Account cascade-delete when their parent User is removed. Uses `cuid()` for all primary keys and includes standard `createdAt`/`updatedAt` timestamps. Developers adding models or fields must run Prisma migrations to keep the database in sync.
