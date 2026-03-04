# Codebase Context Document — HallPass User API

## Overall Architecture and Service Responsibilities

This is a **monorepo** with a service-oriented structure:

- **`apps/user-api`** — Express REST API responsible for user CRUD and authentication. Runs as a standalone service (identifiable by `health` endpoint returning `{ service: "user-api" }`).
- **`packages/db`** — Shared Prisma client and schema (PostgreSQL). Exports `prisma` singleton and Prisma-generated types like `Role`.
- **`packages/auth`** — Shared Better Auth configuration. Wraps `better-auth` with Prisma adapter, exports `createAuth`, `toNodeHandler`, and `fromNodeHeaders`.

The monorepo uses the `@hallpass/*` namespace for internal packages (`@hallpass/db`, `@hallpass/auth`).

## Authentication and Authorization Patterns

### Authentication: Better Auth + Session-based

Auth is configured once per service via the shared `createAuth` factory:

```ts
// apps/user-api/src/auth.ts
export const auth = createAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
});
```

Better Auth handles all `/api/auth/*` routes directly (signup, login, session management) via its Node handler:

```ts
app.all("/api/auth/*splat", authLimiter, toNodeHandler(auth));
```

Session resolution in middleware uses `auth.api.getSession` with converted Node headers:

```ts
const session = await auth.api.getSession({
  headers: fromNodeHeaders(req.headers),
});
```

The authenticated user is loaded from the database (checking `deletedAt: null`) and attached to `req.user`. This means `req.user` is the **full Prisma `User` record**, not just the session payload.

### Authorization: Role-based with rank hierarchy

Roles are hierarchical: `STUDENT(0) < TEACHER(1) < ADMIN(2) < SUPER_ADMIN(3) < SERVICE(4)`.

Three authorization middleware patterns are used:

| Middleware | Use case | Example |
|---|---|---|
| `requireRole(...roles)` | Endpoint restricted to specific roles | `requireRole(Role.ADMIN, Role.SUPER_ADMIN)` |
| `requireSelfOrRole(...roles)` | User can access own resource, or needs specified role | `requireSelfOrRole(Role.TEACHER, Role.ADMIN, Role.SUPER_ADMIN)` |
| `roleRank()` inline checks | Prevent privilege escalation (e.g., can't assign a role higher than your own) | `roleRank(targetRole) > roleRank(req.user!.role)` |

**Critical pattern: privilege escalation prevention** — Used in create, update, and delete:

```ts
// Can't create a user with a higher role than yourself
if (roleRank(targetRole) > roleRank(req.user!.role as Role)) {
  res.status(403).json({ message: "Forbidden" });
  return;
}

// Can't delete a user with equal or higher role
if (roleRank(user.role as Role) >= roleRank(req.user!.role as Role)) {
  res.status(403).json({ message: "Forbidden" });
  return;
}
```

Note: Delete uses `>=` (can't delete peers), while create/update use `>` (can assign own-level role).

### `req.user` type augmentation

The code accesses `req.user` with type assertions (`req.user!`, `req.user!.role as Role`), indicating Express `Request` is augmented somewhere (likely a `types.d.ts` or global declaration not shown). The user object has at minimum: `id`, `role`, `email`, `name`, `createdAt`, `deletedAt`.

## Route and Controller Conventions

### Route structure
Routes are grouped by resource in `src/routes/` and mounted on the app with a prefix:

```ts
app.use("/api/users", userRouter);
```

### Middleware chain ordering
Every protected route follows this exact pattern:

```ts
router.method(
  "/path",
  requireAuth,           // 1. authenticate
  validateParams(schema),// 2. validate input
  validateBody(schema),  //    (params, query, and/or body)
  requireRole(...),      // 3. authorize
  async (req, res) => {} // 4. handler
);
```

**Static routes must be declared before parameterized routes** — explicitly called out with comment:

```ts
// batch must come before /:id
router.get("/batch", ...);
router.get("/:id", ...);
```

### Response conventions

| Scenario | Status | Body |
|---|---|---|
| Success (read/update) | 200 | Resource JSON |
| Created | 201 | Resource JSON |
| Deleted | 204 | Empty |
| Validation error | 400 | `{ message: "Invalid body", errors: <zod flatten> }` |
| Unauthenticated | 401 | `{ message: "Unauthorized" }` |
| Insufficient role | 403 | `{ message: "Forbidden" }` |
| Not found | 404 | `{ message: "User not found" }` |
| Rate limited | 429 | `{ message: "Too many requests" }` |
| Server error | 500 | `{ message: "Internal server error" }` |

### Select projection
All read/write endpoints use explicit `select` to control response shape — never return raw records:

```ts
select: {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
},
```

This notably **excludes** `updatedAt`, `deletedAt`, `emailVerified`.

## Database / Migration Patterns

### Prisma + PostgreSQL

- IDs are **CUID strings** (`@id @default(cuid())`), not UUIDs or integers.
- Timestamps use `createdAt` / `updatedAt` (Prisma `@updatedAt` auto-managed).
- **Soft deletes** via nullable `deletedAt` field. Every query filters `deletedAt: null`:

```ts
where: { id: req.params.id, deletedAt: null }
```

- Delete operations are updates that set `deletedAt`:

```ts
await prisma.user.update({
  where: { id: req.params.id },
  data: { deletedAt: new Date() },
});
```

### Schema relationships
- `User` → `Session` (one-to-many, cascade delete)
- `User` → `Account` (one-to-many, cascade delete)
- `Session` and `Account` are managed by Better Auth, not application code.

### Role enum
Defined in Prisma schema and used throughout via `@hallpass/db` export:

```ts
import { prisma, Role } from "@hallpass/db";
```

`SERVICE` role exists in schema but is **not exposed** in API create/update schemas (only `STUDENT | TEACHER | ADMIN | SUPER_ADMIN` are allowed as input).

## Error Handling Patterns

**No try/catch in route handlers.** Async errors in route handlers are NOT caught — there's a global error handler but Express doesn't automatically forward async rejections to it (no `express-async-errors` or wrapper seen). This is a known gap.

The only try/catch is in `requireAuth` middleware for session resolution:

```ts
try {
  session = await auth.api.getSession({ ... });
} catch {
  res.status(401).json({ message: "Unauthorized" });
  return;
}
```

Global handlers:
```ts
// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

// 500 error handler (4-arg signature)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});
```

## Validation Patterns

Zod schemas defined in `src/schemas/` per resource. Three validation middleware variants:

| Middleware | Validates | On failure |
|---|---|---|
| `validateBody(schema)` | `req.body` — **overwrites** `req.body` with parsed data | 400 + flattened errors |
| `validateQuery(schema)` | `req.query` — does **not** overwrite | 400 + flattened errors |
| `validateParams(schema)` | `req.params` — **overwrites** with parsed data | 400 + flattened errors |

Note the asymmetry: `validateBody` and `validateParams` replace the original with parsed/stripped data, but `validateQuery` does not.

## Key Dependencies

| Package | Purpose |
|---|---|
| `better-auth` | Auth framework (email/password, sessions). Mounted as raw Node handler. |
| `prisma` / `@prisma/client` | ORM, database access, schema/migration management |
| `zod` | Request validation (body, query, params) and env var parsing |
| `express-rate-limit` | Two tiers: 100 req/15min global, 10 req/15min for auth routes |
| `helmet` | Security headers |
| `cors` | CORS (currently permissive — `cors()` with no config, marked TODO) |
| `morgan` | Request logging (`dev` format) |

## Environment Variables and Config

Validated at startup with Zod — process crashes immediately on invalid config:

```ts
const envSchema = z.object({
  DATABASE_URL: z.string(),       // PostgreSQL connection string (used by Prisma)
  BETTER_AUTH_URL: z.string(),    // Base URL for Better Auth (e.g., http://localhost:3000)
  BETTER_AUTH_SECRET: z.string(), // Secret for session signing
  PORT: z.string().optional(),    // Server port (optional, presumably has default)
});

export const env = envSchema.parse(process.env);
```

`DATABASE_URL` is consumed by Prisma implicitly (not passed in app code). The other variables are explicitly passed to `createAuth`.

## Additional Observations for Reviewers

1. **`trust proxy` is enabled** (`app.set("trust proxy", 1)`) — rate limiting and IP detection rely on proxy headers.
2. **Batch endpoint** limits to 100 IDs, uses comma-separated query string (`?ids=a,b,c`).
3. **Role is cast throughout** (`req.user!.role as Role`) — the Prisma type may not be narrowing automatically to the enum, or `req.user` type definition uses `string`.
4. **No pagination** on any endpoints currently.
5. **Auth routes use a wildcard splat** pattern: `/api/auth/*splat` — this is Express 5 syntax.