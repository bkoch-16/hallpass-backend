# Codebase Context Document — HallPass User API

## Overall Architecture and Service Responsibilities

This is a **monorepo** with a microservice-oriented structure:

- **`apps/user-api`** — Express-based REST API responsible for user CRUD and authentication. Identified as `"user-api"` in the health endpoint, implying other services exist or are planned.
- **`packages/db`** — Shared Prisma client and schema (PostgreSQL). Exports `prisma` singleton and enums like `Role`.
- **`packages/auth`** — Shared Better Auth configuration wrapping `better-auth` with Prisma adapter. Exports `createAuth`, `toNodeHandler`, and `fromNodeHeaders`.

The service boundary is clear: `user-api` owns user/session/account data. Other services would import `@hallpass/db` and `@hallpass/auth` as needed.

## Authentication and Authorization Patterns

### Authentication: Better Auth + Session-based

Auth is initialized once per service and mounted as a catch-all handler:

```ts
// apps/user-api/src/app.ts
app.all("/api/auth/*splat", authLimiter, toNodeHandler(auth));
```

Better Auth handles `/api/auth/*` routes (sign-up, sign-in, sign-out, etc.) internally. Email/password auth is enabled; sessions expire in 7 days with daily refresh.

### Session Resolution Middleware

`requireAuth` extracts session from request headers, then verifies the user exists and is not soft-deleted:

```ts
const session = await auth.api.getSession({
  headers: fromNodeHeaders(req.headers),
});
// Then: prisma.user.findFirst({ where: { id: session.user.id, deletedAt: null } })
// Attaches to req.user
```

**Key detail:** `req.user` is augmented on the Express `Request` type (implied by `req.user = user`). There must be a type augmentation somewhere (e.g., `express.d.ts`) adding `user` to `Request`.

### Authorization: Role-based Guards

Two role guard patterns, always applied **after** `requireAuth`:

```ts
// Exact role match — user must have one of the listed roles
requireRole(Role.ADMIN, Role.SUPER_ADMIN)

// Self-access OR role match — user can access their own resource, or must have a listed role
requireSelfOrRole(Role.ADMIN, Role.SUPER_ADMIN)  // checks req.params.id === req.user.id
```

### Role Hierarchy (numeric rank)

```ts
STUDENT: 0, TEACHER: 1, ADMIN: 2, SUPER_ADMIN: 3, SERVICE: 4
```

Used for **escalation prevention** — you cannot assign/update a role higher than your own, and cannot delete users at or above your rank:

```ts
// Creating user: cannot assign role above your own
if (roleRank(targetRole) > roleRank(req.user!.role)) → 403

// Deleting user: cannot delete same rank or above
if (roleRank(user.role) >= roleRank(req.user!.role)) → 403
```

## Route and Controller Conventions

### Pattern: Inline async handlers in route files

Routes are defined in `src/routes/*.ts` as Express `Router` instances, mounted in `app.ts`:

```ts
app.use("/api/users", userRouter);
```

### Middleware chain order (consistent across all routes):

```
requireAuth → validateParams/validateQuery/validateBody → requireRole/requireSelfOrRole → handler
```

Example:
```ts
router.patch(
  "/:id",
  requireAuth,
  validateParams(userIdSchema),
  validateBody(updateUserSchema),
  requireSelfOrRole(Role.ADMIN, Role.SUPER_ADMIN),
  async (req: Request, res: Response) => { ... }
);
```

### Response conventions:

| Scenario | Status | Body |
|---|---|---|
| Success (read/update) | 200 | JSON entity |
| Success (create) | 201 | JSON entity |
| Success (delete) | 204 | Empty |
| Validation error | 400 | `{ message, errors: ZodFlattenedError }` |
| Unauthenticated | 401 | `{ message: "Unauthorized" }` |
| Insufficient role | 403 | `{ message: "Forbidden" }` |
| Not found | 404 | `{ message: "User not found" }` or `{ message: "Not found" }` |
| Server error | 500 | `{ message: "Internal server error" }` |

### Select projection — consistent field whitelist for user responses:

```ts
select: { id: true, email: true, name: true, role: true, createdAt: true }
```

This is repeated on every query. `updatedAt`, `deletedAt`, `emailVerified` are never exposed.

### Important routing note:

```ts
// "/batch" must come before "/:id" to avoid /:id capturing "batch" as an id
router.get("/batch", ...);
router.get("/:id", ...);
```

## Database / Migration Patterns

### Prisma with PostgreSQL

- IDs: `cuid()` strings (not UUIDs, not autoincrement)
- Timestamps: `createdAt` (default `now()`), `updatedAt` (`@updatedAt`), `deletedAt` (nullable — soft delete)
- Enums defined at database level (`enum Role`)
- Cascade deletes on `Session` and `Account` when `User` is deleted

### Soft Delete Pattern

Deletes set `deletedAt` rather than removing rows:

```ts
await prisma.user.update({
  where: { id: req.params.id },
  data: { deletedAt: new Date() },
});
```

**All read queries must filter `deletedAt: null`** — this is done manually on every query, not via Prisma middleware:

```ts
prisma.user.findFirst({ where: { id, deletedAt: null } })
```

### Shared Prisma instance

`@hallpass/db` exports a singleton `prisma` client used by both `@hallpass/auth` (via adapter) and route handlers directly.

## Error Handling Patterns

### Validation errors (Zod)

```ts
res.status(400).json({ message: "Invalid body", errors: result.error.flatten() });
```

`validateBody` replaces `req.body` with parsed data on success (sanitizing unknown fields). `validateQuery` and `validateParams` do **not** replace their respective objects — they only validate.

### No try/catch in route handlers

Route handlers do **not** wrap Prisma calls in try/catch. Unhandled errors fall through to the global error handler:

```ts
app.use((err: Error, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});
```

This means Prisma unique constraint violations (e.g., duplicate email on user create) will return a generic 500 rather than a descriptive 400.

## Key Dependencies and Why They're Used

| Package | Purpose |
|---|---|
| `better-auth` | Session-based auth with built-in email/password, session management, adapters |
| `prisma` / `@prisma/client` | Type-safe ORM, shared across packages via `@hallpass/db` |
| `zod` | Request validation (body, query, params) and env var validation |
| `express-rate-limit` | Two tiers: 100 req/15min global, 10 req/15min on `/api/auth/*` |
| `helmet` | Security headers |
| `cors` | CORS (currently permissive — `cors()` with no origin restriction, marked TODO) |
| `morgan` | Request logging (`"dev"` format) |

## Environment Variable and Config Conventions

All env vars validated at startup with Zod — the process will crash immediately if any required var is missing:

```ts
const envSchema = z.object({
  DATABASE_URL: z.string(),       // Prisma connection string
  BETTER_AUTH_URL: z.string(),    // Base URL for auth (e.g., http://localhost:3000)
  BETTER_AUTH_SECRET: z.string(), // Signing secret for sessions
  PORT: z.string().optional(),    // Server port, optional with fallback
});
export const env = envSchema.parse(process.env);
```

No `.env` loading is shown — presumably handled by the runtime environment or a top-level dotenv config.

## Notable Patterns and Potential Review Focus Areas

1. **`validateBody` mutates `req.body`** with Zod output (strips unknown fields); `validateQuery`/`validateParams` do not — inconsistent behavior.
2. **No async error wrapping** — Express 4 does not catch rejected promises from `async` handlers automatically. If this is Express 4, unhandled rejections may crash the process rather than hitting the error handler. Express 5 fixes this.
3. **Soft delete filter is manual** — easy to forget `deletedAt: null` on new queries.
4. **`req.user!` non-null assertions** — used in handlers after `requireAuth`, which is safe by convention but not type-enforced.
5. **CORS is wide open** — noted with a TODO in source.
6. **`trust proxy` is set to 1** — required for rate limiting behind a reverse proxy.
7. **SERVICE role (rank 4)** exists in the enum and rank map but is never assignable through the API (not in the `createUserSchema` or `updateUserSchema` enums), suggesting it's reserved for service-to-service auth.