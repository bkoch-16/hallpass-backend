# Tech Debt

Findings from the full-codebase audit (2026-07-13), updated with the web-app-readiness audit (2026-07-17). Severity: 🔴 blocks or breaks a real client / exploitable, 🟠 real defect or policy gap, 🟡 friction or drift.

Known-and-accepted trade-offs are listed at the bottom so they don't get re-reported; they are documented in-code and are **not** open items.

---

## 1. Web-app blockers

### 🟠 Pass responses are ID-only with no expansion mechanism
`PassResponse` carries `studentId`/`destinationId`/`approverId` with no names. A live pass board joins across services client-side; socket events (`emitPassEvent`) also carry the bare row, so realtime updates trigger lookup fetches.

**Fix:** an `?include=` option, or denormalize `studentName`/`destinationName` into the pass payload (REST + socket).

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

### 🟡 Small items
- Soft-deleting a user now revokes its better-auth sessions on `DELETE /api/users/:id`, but the email row is still occupied forever — the user can never be re-provisioned (409). Email-reuse story is still undecided.
- `change-password` has no `email` in its body, so the strict auth limiter falls back to per-IP keying (`packages/middleware/src/rateLimit.ts:123-129`) — 10/15min shared across a school NAT for password changes.
- Provisioning now emails a 7-day set-password invite link (`apps/user-api/src/routes/user.ts:56-59`), but the `tempPassword` returned in the response itself still never expires and nothing forces a change on first login.
- `INTERNAL_SECRET` only requires `min(1)` (`apps/passes-api/src/env.ts`) — enforce a real minimum length for the static bearer guarding `/internal/reconcile-expiry`.
- ADMINs with `schoolId: null` are 403'd on reads but silently create `schoolId: null` users via `POST /api/users` and `/bulk` — users they can then never see or manage. Reject like the read paths.
- No audit trail for admin actions (role changes, deletions). Eventually a K-12 compliance expectation; noted, not urgent.

---

## 3. Correctness

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

1. `z.infer`-derived body types before frontend consumption starts (prevents real client bugs); other DRY items opportunistically.

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
- ADMINs can create/promote peer ADMINs (`>` not `>=` rank check on create/promote in `user.ts`) while PATCH/DELETE block acting on peers — intentional; documented in-code at the rank checks.
