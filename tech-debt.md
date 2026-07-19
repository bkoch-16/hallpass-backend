# Tech Debt

Findings from the full-codebase audit (2026-07-13), updated with the web-app-readiness audit (2026-07-17). Severity: 🔴 blocks or breaks a real client / exploitable, 🟠 real defect or policy gap, 🟡 friction or drift.

Known-and-accepted trade-offs are listed at the bottom so they don't get re-reported; they are documented in-code and are **not** open items.

---

## 1. Web-app blockers

### 🔴 Forgot password is non-functional — no email infrastructure exists
`packages/auth/src/index.ts` configures `emailAndPassword` with no `sendResetPassword` callback, so `POST /api/auth/request-password-reset` cannot deliver a token. No mailer dependency or provider exists anywhere in the repo (`docs/ONBOARDING.md:121` acknowledges this). Ironically the reset routes are already rate-limited (`apps/user-api/src/app.ts:64-73`) — anticipated but dead.

**Fix:** pick an email provider (Resend fits the free-tier posture), wire `sendResetPassword` in `createAuth`, build the SPA reset page.

### 🔴 Bulk-provisioned users can never log in — temp passwords are discarded
`POST /api/users` returns `tempPassword` once in the 201, but `POST /api/users/bulk` returns only a `{created, failed}` summary (`apps/user-api/src/routes/user.ts:272`) — the generated credentials are never surfaced to anyone. There is no invite / set-initial-password flow, temp passwords never expire, and nothing forces a change on first login.

**Fix:** invite flow (signed short-lived token + public set-password endpoint — sketched in `docs/ONBOARDING.md:99-107`; needs no email provider) or transactional-email invites once the mailer above exists. Minimum: return per-user temp passwords from `/bulk`.

### 🟠 Non-SUPER_ADMIN users cannot read their own school
`GET /api/schools/:id` is `requireRole(SUPER_ADMIN)` (`apps/schools-api/src/routes/school.ts:65-68`). A student/teacher/admin client can't fetch the school's name or `timezone` — needed to render period times and pass expiry. Sub-resources are readable via `requireSchoolAccess`; the school entity itself isn't.

**Fix:** allow school-scoped reads on `GET /:id`, or embed the school in `GET /api/users/me`.

### 🟠 Pass responses are ID-only with no expansion mechanism
`PassResponse` carries `studentId`/`destinationId`/`approverId` with no names. A live pass board joins across services client-side; socket events (`emitPassEvent`) also carry the bare row, so realtime updates trigger lookup fetches.

**Fix:** an `?include=` option, or denormalize `studentName`/`destinationName` into the pass payload (REST + socket).

### 🟠 No "today's schedule / current period" endpoint
The active-period resolution (calendar entry → schedule type → period windows with buffers, in the school's timezone) lives only inside `POST /api/passes` (`apps/passes-api/src/routes/passes.ts:111-170`). Any screen showing "current period" must re-implement it client-side from calendar + periods + policy — and can't even get the timezone (see school-read item above).

**Fix:** expose the resolver, e.g. `GET /api/schools/:schoolId/schedule/today` returning date, scheduleType, periods, and current period.

### 🟠 Pass list filtering is single-status only
`listPassesQuery` accepts one `status` enum plus cursor (`apps/passes-api/src/schemas/passes.ts:28-31`) — no multi-status, no `studentId`, no date range. `docs/SCHEMA_PLAN.md:548` even instructs clients to reconnect with `?status=PENDING,WAITING,ACTIVE`, which the schema rejects. The teacher board (ACTIVE+WAITING in one call) and student history (date range) need these.

**Fix:** multi-status, `studentId`, and `from`/`to` filters on `GET /api/passes`.

### 🟠 No user search for teacher flows
`GET /api/users` filters only by `role`/`ids` (`apps/user-api/src/schemas/user.ts:8-13`). The "create pass for a student" flow has no name/email search — the client would page the whole roster.

**Fix:** a `?q=` name/email substring filter on `GET /api/users`.

### 🟡 Socket event/room contract is not exported
The 7 event names and room conventions are inline string literals in `passes.ts`/`lib/slots.ts`/`lib/expiry.ts`, documented only in `docs/SCHEMA_PLAN.md:529-546`. A frontend has nothing to import.

**Fix:** export the event/room catalog as constants (and payload types) from `@hallpass/types`.

### 🟡 demo-ui's auth bootstrap must not be copied by the real SPA
demo-ui signs in with `credentials: 'include'` and then reads the token from the `get-session` JSON body (`apps/demo-ui/app.js:58-61`) — a cross-site-cookie round-trip that Safari ITP / Chrome third-party-cookie phaseout can silently break. The supported flow is capturing the `set-auth-token` response header per `docs/AUTH.md`.

### 🟡 SPA deployment prerequisites (ops, not code)
- Append the SPA origin to `CORS_ORIGIN` on **all three** Cloud Run services — the one var drives HTTP CORS, better-auth `trustedOrigins` (user-api), and Socket.io CORS (passes-api).
- Frontend must handle two error shapes: app envelope `{ message, errors? }` vs better-auth `{ code, message }` under `/api/auth/*`.
- No compression middleware anywhere and Cloud Run doesn't gzip; optional but list endpoints would benefit. Consider a CORS `maxAge` to cut preflights against scale-to-zero services.
- user-api's general limiter (100 req/15 min per user) may be tight for a chatty SPA — watch, don't pre-fix.

### 🟡 Inconsistent list response shapes and id-param styles
Users/districts/schools/passes return a `CursorPage` envelope; schedule types/periods/calendar/destinations return bare arrays. Id params: string-regex schemas (user, district, school) vs `z.coerce.number()` (everything else).

### 🟡 No OpenAPI spec
Postman collection is the only machine-readable contract, and `@hallpass/types` has drifted from the validators (§4), so a frontend can't safely codegen from either.

### 🟡 `docker-compose.yml` omits passes-api
Frontend devs can't spin up the realtime API locally the way they can the other two services.

---

## 2. Security

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
- `change-password` has no `email` in its body, so the strict auth limiter falls back to per-IP keying (`packages/middleware/src/rateLimit.ts:123-129`) — 10/15min shared across a school NAT for password changes.
- Temp passwords from admin provisioning never expire and nothing forces a change on first login (see the 🔴 onboarding item in §1).
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

### 🟡 `docs/ONBOARDING.md` documents a dead flow
Its primary "self-signup + promote" flow predates `disableSignUp: true` (commit 419544d) and contradicts `docs/AUTH.md` — sign-up now rejects with BAD_REQUEST. Only the temp-password path works. Update when onboarding work starts.

---

## Suggested priority

1. Email provider + forgot password + invite/bulk-credential delivery (one work stream — same infrastructure).
2. SPA-shaped API gaps, all small and additive: school in `/me`, current-period endpoint, pass filters, user search.
3. Before the login page is public: auth-limiter keying (email+IP), ADMIN peer-creation policy, session revocation on delete.
4. Cap calendar bulk, handle `districtId` P2003, period time validation, `:schoolId` param validation.
5. `z.infer`-derived body types before frontend consumption starts (prevents real client bugs); other DRY items opportunistically.

---

## Known-and-accepted trade-offs (not open items)

Documented in-code with sound reasoning; listed so future audits don't re-flag them:

- Count-then-create quota TOCTOU on `POST /passes` — bounded by the `one_active_pass_per_student` partial unique index.
- Stale Redis occupancy counters after a `maxOccupancy` PATCH — self-heal on the next reconcile sweep.
- Rate limiting fails open on Redis store errors (`passOnStoreError: true`) — an Upstash outage must not take down the APIs.
- In-process expiry timers are lost on Cloud Run scale-to-zero — the `reconcile-expiry` sweep is the backstop.
- `express.json()` mounted before `toNodeHandler(auth)` — verified working on better-auth 1.5.4 by the real-auth integration tests.
- `corsOptions` sets no `exposedHeaders` — not a gap: better-auth's `bearer()` plugin sets `Access-Control-Expose-Headers: set-auth-token` on the response itself (verified in 1.5.4, `plugins/bearer/index.mjs:71-73`).
- Preflight, `trust proxy`, helmet defaults, and per-session-token rate-limit keying are all correct for a cross-origin SPA — audited 2026-07-17, no changes needed.
