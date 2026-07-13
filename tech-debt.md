# Tech Debt

Findings from the full-codebase audit (2026-07-13). Severity: 🔴 blocks or breaks a real client / exploitable, 🟠 real defect or policy gap, 🟡 friction or drift.

Known-and-accepted trade-offs are listed at the bottom so they don't get re-reported; they are documented in-code and are **not** open items.

---

## 1. Web-app blockers

### 🔴 Auth rate limiter throttles `get-session` per IP
`app.all("/api/auth/*splat", authLimiter, ...)` (`apps/user-api/src/app.ts:65`) applies the strict auth limiter to every better-auth route, all methods. The limiter keys by `req.body.email` with IP fallback (`packages/middleware/src/rateLimit.ts:104-118`). `GET /api/auth/get-session` has no body, so an entire school behind one NAT IP shares a 10-per-15-min bucket — a SPA that checks the session on page load 429s almost immediately.

**Fix:** apply the auth limiter only to `sign-in`/`sign-up`/password endpoints; everything else rides the general limiter.

### 🔴 Browser Socket.io clients cannot authenticate
`initSocket` resolves the session only from `socket.handshake.headers` (`apps/passes-api/src/lib/socket.ts:36`). Browsers can't set `Authorization` on a WebSocket upgrade, and the better-auth cookie belongs to user-api's origin, not passes-api's — neither auth path works from a browser.

**Fix:** also accept the token via `socket.handshake.auth.token` (socket.io-client `auth` option, works on all transports) and feed it through session resolution.

### 🔴 Cross-origin cookie auth can't work on the current deployment
The three services live on separate `*.run.app` hosts; `run.app` is on the Public Suffix List, so one cookie can never cover all three. A web app is forced into the Bearer flow (the `bearer()` plugin is enabled): capture `set-auth-token` at sign-in, attach `Authorization` everywhere. Undocumented, and forfeits httpOnly protection (token is XSS-stealable from JS storage).

**Fix:** document the intended Bearer flow explicitly, or front all three services with one custom domain so cookies work.

### 🟠 Non-SUPER_ADMIN users cannot read their own school
`GET /api/schools/:id` is `requireRole(SUPER_ADMIN)` (`apps/schools-api/src/routes/school.ts:65-68`). A student/teacher/admin client can't fetch the school's name or `timezone` — needed to render period times and pass expiry. Sub-resources are readable via `requireSchoolAccess`; the school entity itself isn't.

**Fix:** allow school-scoped reads on `GET /:id`, or embed the school in `GET /api/users/me`.

### 🟠 Pass responses are ID-only with no expansion mechanism
`PassResponse` carries `studentId`/`destinationId`/`approverId` with no names. A live pass board joins across services client-side; socket events (`emitPassEvent`) also carry the bare row, so realtime updates trigger lookup fetches.

**Fix:** an `?include=` option, or denormalize `studentName`/`destinationName` into the pass payload (REST + socket).

### 🟡 Inconsistent list response shapes and id-param styles
Users/districts/schools/passes return a `CursorPage` envelope; schedule types/periods/calendar/destinations return bare arrays. Id params: string-regex schemas (user, district, school) vs `z.coerce.number()` (everything else).

### 🟡 No OpenAPI spec
Postman collection is the only machine-readable contract, and `@hallpass/types` has drifted from the validators (§4), so a frontend can't safely codegen from either.

### 🟡 `docker-compose.yml` omits passes-api
Frontend devs can't spin up the realtime API locally the way they can the other two services.

---

## 2. Security

### 🔴 Public self-signup is open
`emailAndPassword: { enabled: true }` with no `disableSignUp` (`packages/auth/src/index.ts:28`) — anyone can `POST /api/auth/sign-up/email` on the deployed API. `role`/`schoolId` are `input: false` so no escalation, but provisioning is admin-driven (`POST /api/users`); open signup invites junk rows and abuse.

**Fix:** `disableSignUp: true`. (Email verification is never required either; matters less once signup is closed.)

### 🟠 Account-lockout griefing via the auth limiter
Keying sign-in by `body.email` alone lets an attacker 429-lock a victim's sign-in indefinitely (10 junk attempts per window from anywhere).

**Fix:** limit per email+IP pair, plus a looser pure-email cap.

### 🟠 ADMIN can mint peer ADMINs — contradicts the PATCH/DELETE policy
`POST /api/users` blocks only `targetRole > callerRole` (`apps/user-api/src/routes/user.ts:165`; same for `/bulk`), and PATCH `role` promotion is also `>` not `>=` (`user.ts:262`). Meanwhile PATCH/DELETE forbid acting on equal-or-greater-rank targets. An admin can't edit a peer but can create unlimited new peers or promote a student to ADMIN.

**Fix:** decide the policy; if lateral escalation is unintended, make create/promote checks `>=` at the ADMIN tier. If intended, comment it.

### 🟡 Soft-deleting a user doesn't revoke better-auth sessions
`resolveSessionUser` filters `deletedAt` so the APIs 401, but the live session still works against `/api/auth/*` (change-password, get-session), and the email row is occupied forever — the user can never be re-provisioned (409).

**Fix:** delete sessions in the DELETE handler; decide an email-reuse story.

### 🟡 Small items
- `INTERNAL_SECRET` only requires `min(1)` (`apps/passes-api/src/env.ts`) — enforce a real minimum length for the static bearer guarding `/internal/reconcile-expiry`.
- ADMINs with `schoolId: null` are 403'd on reads but silently create `schoolId: null` users via `POST /api/users` and `/bulk` — users they can then never see or manage. Reject like the read paths.
- No audit trail for admin actions (role changes, deletions). Eventually a K-12 compliance expectation; noted, not urgent.

---

## 3. Correctness

### 🟠 Unknown `districtId` on school create/patch → 500
`POST /api/schools` passes `districtId` straight through (`apps/schools-api/src/routes/school.ts:54`); a nonexistent district throws Prisma P2003 → generic 500. Same gap on PATCH. user-api already handles P2003 for `schoolId` — reuse that pattern.

### 🟠 Unbounded calendar bulk upsert
`calendarBulkSchema` has `.min(1)` but no `.max` (`apps/schools-api/src/schemas/calendar.ts:35`); the handler builds one raw SQL `VALUES` list from the whole array. User bulk caps at 100; cap this too (a school year is ~200 entries, 366 is a natural bound).

### 🟠 Periods have no time-sanity validation
`createPeriodSchema` accepts `endTime < startTime` and overlapping/duplicate-order periods. passes-api derives the active period and expiry from these strings, so a bad period silently yields "No active period" 422s or instant expiries. Validate `startTime < endTime` at minimum.

### 🟡 Missing `:schoolId` validation on collection GETs → 500 for SUPER_ADMIN
Nested `GET /` routes (destinations, schedule types, calendar, policy) never validate `:schoolId`. Non-admins are saved by the `!==` in `requireSchoolAccess`, but SUPER_ADMIN on `/api/schools/abc/destinations` reaches Prisma with `NaN` → 500. `schoolParamSchema` exists for exactly this (`apps/schools-api/src/schemas/school.ts:7`) and is used nowhere.

### 🟡 Delete-protection is inconsistent across the hierarchy
Destination delete blocks on in-flight passes; scheduleType delete blocks on calendar refs; school and district soft-deletes have no guards — a school with ACTIVE passes and enrolled users can be deleted, stranding its users. Decide the invariant and apply uniformly.

### 🟡 Wrong-state pass transitions return 400, contradicting `docs/API_CONVENTIONS.md`
The convention says business-rule failures are 422, but approve/deny/return/cancel return 400 for "Pass is not PENDING/ACTIVE/..." (`apps/passes-api/src/routes/passes.ts`). Pick one and align — clients branch on these codes.

---

## 4. DRY / drift

### 🟠 `@hallpass/types` has drifted from the Zod schemas, and nothing enforces agreement
- `CalendarEntryBody.scheduleTypeId` is `string | null` (`packages/types/src/index.ts:188`) but the validator requires a number.
- `UpdateSchoolBody.districtId` is `number?` but the schema accepts `null` to clear it.

**Fix:** derive request-body types from the schemas (`z.infer`) and export those; keep response interfaces hand-written.

### 🟡 Service bootstrap is triplicated
`auth.ts` byte-identical ×3; `env.ts` identical ×2; `app.ts` repeats helmet/CORS/logger/health/limiter/error-handler wiring; the RedisStore setup is a helper in user-api but inlined in the other two. A shared `createBaseApp(serviceName, env)` collapses ~150 lines and guarantees middleware fixes land in all three services.

### 🟡 Cursor-pagination block copy-pasted five times
users, districts, schools, passes — `take + 1`, slice, `nextCursor`. Extract a `paginate()` helper.

### 🟡 Prisma error-code sniffing reimplemented three ways
`isUniqueViolation` (passes), `isDuplicateEmailError` (users), inline P2003 check (users PATCH). One shared `isPrismaError(err, code)` in the middleware package.

### 🟡 Naming and ordering nits
`requireSchool` (passes-api) vs `requireSchoolAccess` (schools-api) are different contracts with confusingly similar names; middleware order flips between routes (`validateBody` before `requireRole` on `POST /users`, after on `/bulk`).

---

## Suggested priority

1. Auth-limiter scope (get-session), close public signup, accept socket token via `handshake.auth` — small diffs that unblock any real web client.
2. Decide and document the browser auth story (Bearer flow or shared custom domain).
3. Expose school (or embed in `/me`), cap calendar bulk, handle `districtId` P2003, align the ADMIN-peer-creation policy.
4. DRY items opportunistically — `z.infer`-derived body types first (prevents real client bugs).

---

## Known-and-accepted trade-offs (not open items)

Documented in-code with sound reasoning; listed so future audits don't re-flag them:

- Count-then-create quota TOCTOU on `POST /passes` — bounded by the `one_active_pass_per_student` partial unique index.
- Stale Redis occupancy counters after a `maxOccupancy` PATCH — self-heal on the next reconcile sweep.
- Rate limiting fails open on Redis store errors (`passOnStoreError: true`) — an Upstash outage must not take down the APIs.
- In-process expiry timers are lost on Cloud Run scale-to-zero — the `reconcile-expiry` sweep is the backstop.
- `express.json()` mounted before `toNodeHandler(auth)` — verified working on better-auth 1.5.4 by the real-auth integration tests.
