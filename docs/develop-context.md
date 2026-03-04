# Codebase Context Document — HallPass User API

## Overall Architecture and Service Responsibilities

This is a **monorepo** with a microservice-oriented structure:

- **`apps/user-api`** — Express.js REST API responsible for user CRUD operations and authentication. This is the primary (possibly only) service currently.
- **`packages/db`** — Shared Prisma client and schema, exported as `@hallpass/db`. Provides `prisma` client instance and the `Role` enum.
- **`packages/auth`** — Shared authentication layer wrapping [better-auth](https://www.better-auth.com/), exported as `@hallpass/auth`. Provides `createAuth`, `toNodeHandler`, and `fromNodeHeaders`.

The pattern is: **shared packages under `packages/`**, **deployable services under `apps/`**. Packages are imported via workspace aliases (`@hallpass/db`, `@hallpass/auth`).

---

## Authentication and Authorization Patterns

### Authentication: better-auth with session-based auth

Auth is initialized once per service via `createAuth()` and mounted as a catch-all Express handler:

```ts
app.all("/api/auth/*splat", authLimiter, toNodeHandler(auth));
```

This delegates all `/api/auth/*` routes (sign-up, sign-in, sign-out, etc.) to better-auth internally. Email/password auth is enabled. Sessions expire in 7 days, refresh after 1 day.

### Session resolution in middleware

The `requireAuth` middleware resolves the session from request headers, then loads the full user from the database (checking `deletedAt: null` for soft-delete):

```ts
const session = await auth.api.getSession({
  headers: fromNodeHeaders(req.headers),
});
// Then: prisma.user.findFirst({ where: { id: session.user.id, deletedAt: null } })
// Then: req.user = user;
```

The authenticated user is attached to `req.user` (implies a custom type augmentation on `Express.Request`).

### Authorization: Role-based with rank hierarchy

Roles have a strict numeric rank:
```
STUDENT(0) < TEACHER(1) < ADMIN(2) < SUPER_ADMIN(3) < SERVICE(4)
```

Two role guard middlewares:

| Guard | Usage |
|-------|-------|
| `requireRole(...roles)` | User must have one of the listed roles |
| `requireSelfOrRole(...roles)` | User is accessing their own resource (`req.params.id === req.user.id`) OR has one of the listed roles |

**Escalation prevention pattern** — used inline in route handlers, not middleware:
```ts
if (roleRank(targetRole) > roleRank(req.user!.role as Role)) {
  res.status(403).json({ message: "Forbidden" });
  return;
}
```
This prevents users from creating/updating users with a higher role than their own, or deleting users at or above their rank.

---

## Route and Controller Conventions

Routes are defined directly in router files (no separate controller layer). Pattern:

```ts
router.method(
  "/path",
  requireAuth,                          // 1. auth
  validateParams(schema),               // 2. validate input
  validateBody(schema),
  requireRole(Role.X, Role.Y),          // 3. authorize
  async (req: Request, res: Response) => {  // 4. handler
    // business logic inline
  },
);
```

**Middleware ordering is consistent**: `requireAuth` → `validate*` → `requireRole`/`requireSelfOrRole` → handler.

**Route mounting** follows the pattern:
```ts
app.use("/api/users", userRouter);
```

**Response conventions**:
| Scenario | Status | Body |
|----------|--------|------|
| Success (read/update) | 200 | JSON object/array |
| Success (create) | 201 | JSON object |
| Success (delete) | 204 | Empty |
| Validation error | 400 | `{ message, errors: zodFlattened }` |
| Not authenticated | 401 | `{ message: "Unauthorized" }` |
| Not authorized | 403 | `{ message: "Forbidden" }` |
| Not found | 404 | `{ message: "User not found" }` or `{ message: "Not found" }` |
| Server error | 500 | `{ message: "Internal server error" }` |

**Important**: Static routes like `/batch` are registered before parameterized routes like `/:id` to avoid conflicts.

**Select pattern**: All user queries use explicit `select` to avoid leaking sensitive fields:
```ts
select: {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
},
```

---

## Database / Migration Patterns and Conventions

**ORM**: Prisma with PostgreSQL.

**Shared Prisma client**: Instantiated in `@hallpass/db`, imported everywhere as `import { prisma } from "@hallpass/db"`.

**Soft deletes**: Users have a `deletedAt DateTime?` field. All queries filter with `deletedAt: null`. Deletes are implemented as:
```ts
await prisma.user.update({
  where: { id },
  data: { deletedAt: new Date() },
});
```

**ID strategy**: `cuid()` for all primary keys.

**Timestamps**: All models have `createdAt` (auto) and `updatedAt` (`@updatedAt`). User also has optional `deletedAt`.

**Cascade deletes**: Sessions and Accounts cascade-delete when a User is deleted (hard delete at DB level), though the app only soft-deletes users.

**Schema conventions**:
- Enums are defined in Prisma and re-exported from `@hallpass/db`
- `@unique` on `email` (User) and `token` (Session)
- No composite indexes defined yet

---

## Error Handling Patterns

**Validation errors** use Zod's `safeParse` + `error.flatten()`:
```ts
res.status(400).json({ message: "Invalid body", errors: result.error.flatten() });
```

**Auth/authz errors** return early with `return` (no `throw`):
```ts
if (!session) {
  res.status(401).json({ message: "Unauthorized" });
  return;
}
```

**Route handlers do NOT wrap logic in try/catch** — they rely on the global error handler:
```ts
app.use((err: Error, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});
```

**Note**: Since route handlers are `async` but Express 4 doesn't auto-catch async errors, unhandled promise rejections in route handlers will NOT reach the global error handler. This is a known gap — there's no `express-async-errors` or wrapper in use.

---

## Key Dependencies and Why They're Used

| Dependency | Purpose |
|-----------|---------|
| `express` | HTTP framework |
| `better-auth` | Session-based auth (email/password), mounted as Express handler |
| `prisma` | ORM/database access (PostgreSQL) |
| `zod` | Schema validation for env vars, request params/body/query |
| `helmet` | Security headers |
| `cors` | Cross-origin requests (currently open — TODO to restrict) |
| `express-rate-limit` | Rate limiting (100 req/15min general, 10 req/15min for auth) |
| `morgan` | Request logging (`dev` format) |

---

## Environment Variable and Config Conventions

All env vars are validated at startup using Zod. If any are missing/invalid, the process crashes immediately:

```ts
const envSchema = z.object({
  DATABASE_URL: z.string(),
  BETTER_AUTH_URL: z.string(),
  BETTER_AUTH_SECRET: z.string(),
  PORT: z.string().optional(),
});
export const env = envSchema.parse(process.env);
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Prisma PostgreSQL connection string |
| `BETTER_AUTH_URL` | Yes | Base URL for better-auth (e.g. `http://localhost:3000`) |
| `BETTER_AUTH_SECRET` | Yes | Secret key for session signing |
| `PORT` | No | Server listen port |

**Config is not centralized** beyond env — rate limit values, session TTL, etc. are hardcoded inline.

---

## Notable TODOs and Known Gaps

1. **CORS is wide open** — marked with a TODO to configure per environment.
2. **Async error handling gap** — async route handlers without try/catch in Express 4 will produce unhandled rejections rather than 500 responses.
3. **`req.user` type augmentation** — the code assigns `req.user = user` but the type declaration file for `Express.Request` is not shown; it presumably exists elsewhere.
4. **`SERVICE` role exists in the enum but is excluded** from `createUserSchema` and `updateUserSchema` role enums — it cannot be assigned via the API, suggesting it's reserved for machine-to-machine auth.