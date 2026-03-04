# Codebase Context Document — HallPass User API

## Overall Architecture and Service Responsibilities

This is a **monorepo** with a microservice-oriented structure:

- **`apps/user-api`** — Express REST API responsible for user CRUD and authentication. Runs as its own service (identified as `"user-api"` in the health endpoint).
- **`packages/db`** — Shared Prisma client and schema. Exports `prisma` singleton and enums like `Role`.
- **`packages/auth`** — Shared Better Auth configuration. Wraps `better-auth` with Prisma adapter and exports helpers (`toNodeHandler`, `fromNodeHeaders`, `createAuth`).

Packages are imported via workspace aliases: `@hallpass/db`, `@hallpass/auth`.

## Authentication and Authorization Patterns

### Authentication: Better Auth + Session-based

Auth is session-based via `better-auth`. The auth instance is created per-service with env-driven config:

```ts
// apps/user-api/src/auth.ts
export const auth = createAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
});
```

All Better Auth routes (sign-up, sign-in, session, etc.) are mounted as a catch-all with a dedicated stricter rate limiter:

```ts
app.all("/api/auth/*splat", authLimiter, toNodeHandler(auth));
```

### `requireAuth` Middleware

Extracts the session from request headers via `auth.api.getSession`, then loads the full `User` record from Prisma (filtering out soft-deleted users). Attaches the user to `req.user`:

```ts
const session = await auth.api.getSession({
  headers: fromNodeHeaders(req.headers),
});
// ...
const user = await prisma.user.findFirst({
  where: { id: session.user.id, deletedAt: null },
});
req.user = user;
```

**Important:** `req.user` is augmented on the Express `Request` type (likely via a `.d.ts` declaration not shown). Route handlers access it as `req.user!` with a non-null assertion.

### Authorization: Role-based with Rank Hierarchy

Roles have a strict numeric rank: `STUDENT(0) < TEACHER(1) < ADMIN(2) < SUPER_ADMIN(3) < SERVICE(4)`.

Two role guard middlewares:

| Guard | Use Case | Example |
|---|---|---|
| `requireRole(...roles)` | Exact role membership check | `requireRole(Role.ADMIN, Role.SUPER_ADMIN)` |
| `requireSelfOrRole(...roles)` | User can access their own resource (`req.params.id === req.user.id`) OR must have one of the listed roles | `requireSelfOrRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN)` |

**Role escalation prevention** — Route handlers additionally check `roleRank` to prevent users from assigning/modifying roles above their own:

```ts
// Cannot create a user with a higher role than yourself
if (roleRank(targetRole) > roleRank(req.user!.role as Role)) {
  res.status(403).json({ message: "Forbidden" });
  return;
}

// Cannot delete a user of equal or higher rank
if (roleRank(user.role as Role) >= roleRank(req.user!.role as Role)) {
  res.status(403).json({ message: "Forbidden" });
  return;
}
```

## Route and Controller Conventions

### Route Structure

Routes are defined inline in Router files (no separate controller layer). Middleware is chained in a consistent order:

```
requireAuth → validateParams/validateQuery/validateBody → requireRole/requireSelfOrRole → handler
```

**Example:**
```ts
router.patch(
  "/:id",
  requireAuth,                                    // 1. authn
  validateParams(userIdSchema),                   // 2. validate path
  validateBody(updateUserSchema),                 // 3. validate body
  requireSelfOrRole(Role.ADMIN, Role.SUPER_ADMIN),// 4. authz
  async (req: Request, res: Response) => { ... }  // 5. handler
);
```

### Mounting Convention

Routers are mounted under `/api/<resource>`:
```ts
app.use("/api/users", userRouter);
```

### Response Conventions

| Scenario | Status | Body |
|---|---|---|
| Success (read/update) | 200 | JSON resource |
| Success (create) | 201 | JSON resource |
| Success (delete) | 204 | Empty |
| Validation error | 400 | `{ message: "Invalid body", errors: <ZodFlattenedError> }` |
| Unauthenticated | 401 | `{ message: "Unauthorized" }` |
| Unauthorized | 403 | `{ message: "Forbidden" }` |
| Not found | 404 | `{ message: "Not found" }` or `{ message: "User not found" }` |
| Server error | 500 | `{ message: "Internal server error" }` |

### Route Ordering

Static routes are placed **before** parameterized routes to avoid conflicts:
```ts
router.get("/batch", ...);  // before /:id
router.get("/:id", ...);
```

### Select Pattern

All queries use explicit `select` to avoid leaking sensitive fields:
```ts
select: {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
},
```

Note: `updatedAt`, `deletedAt`, `emailVerified` are never returned to clients.

## Database / Migration Patterns

### Prisma with PostgreSQL

- **IDs:** `cuid()` strings (not UUIDs, not auto-increment)
- **Timestamps:** `createdAt` (default `now()`), `updatedAt` (`@updatedAt`), and `deletedAt` (nullable) on `User`
- **Soft deletes:** Users are never hard-deleted. Delete = `update({ data: { deletedAt: new Date() } })`. All read queries filter `deletedAt: null`.
- **Cascade deletes:** Sessions and Accounts cascade on user deletion at the DB level (`onDelete: Cascade`), though the app never hard-deletes.
- **Enums:** Defined in Prisma schema, exported from `@hallpass/db` and used in both validation schemas and middleware.

### Auth Tables

Better Auth's data model is co-located in the same Prisma schema (`Session`, `Account`) rather than being auto-managed. The Prisma adapter is used:
```ts
database: prismaAdapter(prisma, { provider: "postgresql" }),
```

Session config: 7-day expiry, daily refresh (`updateAge: 60 * 60 * 24`).

## Error Handling Patterns

**No try/catch in route handlers** — Unhandled promise rejections from async handlers will hit the global error handler, but note that Express 4 does **not** automatically catch async errors. This is a known gap; the codebase relies on the global handler:

```ts
app.use((err: Error, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});
```

The only explicit try/catch is in `requireAuth` middleware around session retrieval, where failure is treated as 401.

Middleware functions use **early return** pattern (no `else` chains):
```ts
if (!session) {
  res.status(401).json({ message: "Unauthorized" });
  return;
}
```

## Key Dependencies and Why

| Dependency | Purpose |
|---|---|
| `better-auth` | Session-based auth with email/password. Chosen over Passport/custom JWT for built-in session management. |
| `prisma` | Type-safe ORM, shared across packages via `@hallpass/db`. |
| `zod` | Request validation (body, query, params) and env var parsing. |
| `helmet` | Security headers. |
| `express-rate-limit` | Two tiers: general (100/15min) and auth-specific (10/15min). |
| `cors` | Enabled but currently unconfigured (TODO in code). |
| `morgan` | Request logging (`dev` format). |

## Environment Variable Conventions

All env vars are validated at startup with Zod. The process will crash immediately if required vars are missing:

```ts
const envSchema = z.object({
  DATABASE_URL: z.string(),        // Prisma connection string
  BETTER_AUTH_URL: z.string(),     // Base URL for Better Auth (e.g., http://localhost:3000)
  BETTER_AUTH_SECRET: z.string(),  // Session signing secret
  PORT: z.string().optional(),     // Server port, optional
});
export const env = envSchema.parse(process.env);
```

`DATABASE_URL` is consumed by Prisma implicitly (via `@hallpass/db`). The remaining vars are consumed explicitly in the service code.

## Notable Patterns and Reviewer Watch-Points

1. **Async error handling gap:** Route handlers are `async` but not wrapped with an async error catcher. In Express 4, an unhandled rejection in a route won't reach the error middleware. Consider `express-async-errors` or Express 5.
2. **`req.user!` non-null assertions:** Used throughout route handlers, safe only because `requireAuth` runs first in the middleware chain. Reordering middleware would break this silently.
3. **`role` cast:** `req.user!.role as Role` — the Prisma type should already be `Role`, so the cast may indicate a typing gap in the `req.user` declaration.
4. **CORS is wide open:** The code has a TODO to restrict origins.
5. **Batch endpoint cap:** Max 100 IDs, enforced in handler (not schema).