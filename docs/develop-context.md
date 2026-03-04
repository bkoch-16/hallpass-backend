# Codebase Context — develop

_Generated: 2026-03-04T21:36:08.254Z — 12 files indexed_

## File Summaries

### `apps/user-api/src/app.ts`

Configures and exports the Express application instance for the user-api service. Sets up security middleware (helmet, CORS, rate limiting) and request parsing (JSON, morgan logging). Routes auth requests through Better Auth via `toNodeHandler` at `/api/auth/*splat` with a stricter rate limit (10 req/15min), mounts user CRUD routes at `/api/users`, and provides a `/health` endpoint. Includes a catch-all 404 handler and a global error handler. CORS origin configuration is marked as a TODO for per-environment setup.

### `apps/user-api/src/auth.ts`

Creates and exports the Better Auth instance using the `@hallpass/auth` package's `createAuth` factory. Configured with `baseURL` and `secret` from validated environment variables. This singleton is used by both the auth route handler in app.ts and the `requireAuth` middleware for session validation.

### `apps/user-api/src/env.ts`

Validates and exports environment variables using a Zod schema. Requires DATABASE_URL, BETTER_AUTH_URL, and BETTER_AUTH_SECRET as mandatory strings; PORT is optional. Parsing occurs at import time, so the process will fail fast on startup if required variables are missing. All environment access across the user-api should go through the exported `env` object.

### `apps/user-api/src/express.d.ts`

TypeScript declaration file that augments the Express `Request` interface to include an optional `user` property. The user shape mirrors the Prisma User model fields (id, email, name, emailVerified, role, createdAt, updatedAt) with the Role type imported from `@hallpass/db`. This enables type-safe access to `req.user` throughout route handlers and middleware after authentication.

### `apps/user-api/src/index.ts`

Entry point for the user-api service. Loads environment variables via dotenv, imports the validated env config, and starts the Express server on the configured PORT (default 3001). Registers global handlers for `unhandledRejection` and `uncaughtException` that log and exit the process with code 1 to ensure failures are not silently swallowed.

### `apps/user-api/src/middleware/auth.ts`

Exports the `requireAuth` middleware that validates the current session using Better Auth's `getSession` API by converting Node request headers via `fromNodeHeaders`. After session validation, it fetches the full user record from Prisma (excluding soft-deleted users) and attaches it to `req.user`. Returns 401 if session is invalid, missing, or the user is soft-deleted. Must be applied before any role-checking middleware.

### `apps/user-api/src/middleware/roleGuard.ts`

Provides role-based authorization middleware and utilities. Exports `roleRank()` which maps each Role to a numeric hierarchy (STUDENT=0 through SERVICE=4), `requireRole()` which checks if `req.user.role` is in an allowed set, and `requireSelfOrRole()` which additionally permits access when the route param `:id` matches the authenticated user's ID. All guards return 401 if no user is present and 403 if the role check fails. Depends on `requireAuth` having already populated `req.user`.

### `apps/user-api/src/middleware/validate.ts`

Exports three Express middleware factories—`validateQuery`, `validateBody`, and `validateParams`—each accepting a Zod schema. On validation failure, they return a 400 response with flattened Zod errors. `validateBody` replaces `req.body` with the parsed/transformed data (stripping unknown fields), and `validateParams` similarly replaces `req.params`. These should be placed in the middleware chain before business logic handlers.

### `apps/user-api/src/routes/user.ts`

Defines the Express router for user CRUD operations mounted at `/api/users`. Provides five endpoints: GET `/batch` (bulk lookup by IDs, max 100, teacher+ access), GET `/:id` (self or teacher+), POST `/` (admin+ creates users, respecting role hierarchy), PATCH `/:id` (self or admin+ updates, with role escalation prevention), and DELETE `/:id` (admin+ soft-delete, cannot delete equal or higher roles). All routes use `requireAuth`, Zod validation middleware, and role guards. Uses soft-delete pattern (deletedAt filtering) and consistent select projections (id, email, name, role, createdAt). The `/batch` route is intentionally placed before `/:id` to avoid route parameter collision.

### `apps/user-api/src/schemas/user.ts`

Defines Zod validation schemas for user-related API endpoints. Exports `batchQuerySchema` (for querying multiple users by comma-separated IDs), `userIdSchema` (single user ID param), `updateUserSchema` (partial user update requiring at least one field via `.refine()`), and `createUserSchema` (new user creation with required email/name and optional role). All role fields are constrained to the enum `['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN']`. Depends on the `zod` library; modifying role values here should be kept in sync with the database/Prisma enum definitions.

### `packages/auth/src/index.ts`

Configures and exports a shared authentication setup using the `better-auth` library with a Prisma/PostgreSQL adapter. The `createAuth` factory function accepts `baseURL` and `secret`, enables email/password authentication, and sets session expiry to 7 days with a 1-day update age. Exports the `Auth` and `Session` types inferred from the auth instance, plus `toNodeHandler` and `fromNodeHeaders` utilities for Node.js HTTP integration. Depends on `@hallpass/db` for the shared Prisma client. Developers modifying this file should be aware that changes to session configuration or auth plugins affect all consuming services across the monorepo.

### `packages/db/prisma/schema.prisma`

Defines the PostgreSQL database schema for the hallpass application using Prisma ORM. Contains a Role enum (STUDENT, TEACHER, ADMIN, SUPER_ADMIN, SERVICE) and three models: User (with soft-delete via deletedAt), Session (token-based with IP/user-agent tracking), and Account (multi-provider auth support with optional password). Sessions and Accounts cascade-delete when their parent User is removed. All models use cuid() for primary keys and include createdAt/updatedAt timestamps. This is the single source of truth for database structure; changes require running Prisma migrations.
