# Tech Debt

Findings from the full-codebase audit (2026-07-13), updated with the web-app-readiness audit (2026-07-17) and re-verified/extended 2026-07-23 (post-PRs #116-#124; the 2026-07-23 audit's `:schoolId` mutation-validation, pass-transition status code, `pinCode` exposure, `@hallpass/types` drift, and `createUserWithCredential` atomicity findings are fixed on `chore/web-app-readiness-fixes`). Severity: 🔴 blocks or breaks a real client / exploitable, 🟠 real defect or policy gap, 🟡 friction or drift.

Known-and-accepted trade-offs are listed at the bottom so they don't get re-reported; they are documented in-code and are **not** open items.

---

## 1. Web-app blockers

### 🟡 Socket event/room contract is not exported
The 7 event names and room conventions are inline string literals in `passes.ts`/`lib/slots.ts`/`lib/expiry.ts`, documented only in `docs/SCHEMA_PLAN.md:529-546`. A frontend has nothing to import.

**Fix:** export the event/room catalog as constants (and payload types) from `@hallpass/types`.

### 🟡 demo-ui's auth bootstrap must not be copied by the real SPA
demo-ui signs in with `credentials: 'include'` and then reads the token from the `get-session` JSON body (`apps/demo-ui/app.js:53-56`) — a cross-site-cookie round-trip that Safari ITP / Chrome third-party-cookie phaseout can silently break. The supported flow is capturing the `set-auth-token` response header per `docs/AUTH.md`.

### 🟡 SPA deployment prerequisites (ops, not code)
- Append the SPA origin to `CORS_ORIGIN` on **all three** Cloud Run services — the one var drives HTTP CORS, better-auth `trustedOrigins` (user-api), and Socket.io CORS (passes-api).
- Frontend must handle two error shapes: app envelope `{ message, errors? }` vs better-auth `{ code, message }` under `/api/auth/*`.
- No compression middleware anywhere and Cloud Run doesn't gzip; optional but list endpoints would benefit. Consider a CORS `maxAge` to cut preflights against scale-to-zero services.
- user-api's general limiter (100 req/15 min per user) may be tight for a chatty SPA — watch, don't pre-fix.

### 🟡 Inconsistent list response shapes and id-param styles
Users/districts/schools/passes return a `CursorPage` envelope; schedule types/periods/calendar/destinations return bare arrays. Id params: string-regex schemas (user, district, school) vs `z.coerce.number()` (everything else).

### 🟡 No OpenAPI spec
Postman collection is the only machine-readable contract a frontend could codegen from, and it's already incomplete: `GET /api/schools/:schoolId/schedule/today` (added with the SPA-gaps PR) has no request in `postman/collections/hallpass/`.

### 🟡 `docker-compose.yml` omits passes-api
Frontend devs can't spin up the realtime API locally the way they can the other two services.

---

## 2. Security

### 🟡 Small items
- Soft-deleting a user now revokes its better-auth sessions on `DELETE /api/users/:id`, but the email row is still occupied forever — the user can never be re-provisioned (409). Email-reuse story is still undecided.
- `change-password` has no `email` in its body, so the strict auth limiter falls back to per-IP keying (`packages/middleware/src/rateLimit.ts:136-142`) — 10/15min shared across a school NAT for password changes.
- Provisioning now emails a 7-day set-password invite link (`apps/user-api/src/routes/user.ts:56-62`), but the `tempPassword` returned in the response itself still never expires and nothing forces a change on first login.
- `INTERNAL_SECRET` and `PARENT_TOOL_API_KEY` only require `min(1)` (`apps/passes-api/src/env.ts:12-13`, `apps/schools-api/src/env.ts:15`) — enforce a real minimum length. Note `PARENT_TOOL_API_KEY` is a single static, platform-wide credential: with it plus a student PIN, `GET /api/passes/parent-lookup` returns any student's pass history in any school, and the API-key path on the schools-api public GETs reads any school's calendar/schedule data. Acceptable for one trusted voice-AI caller, but there is no rotation story and no per-school scoping.
- ADMINs with `schoolId: null` are 403'd on reads but silently create `schoolId: null` users via `POST /api/users` and `/bulk` (`apps/user-api/src/routes/user.ts:224`, `:286`) — users they can then never see or manage. Reject like the read paths.
- No audit trail for admin actions (role changes, deletions). Eventually a K-12 compliance expectation; noted, not urgent.

---

## 3. DRY / drift

### 🟡 Service bootstrap duplication — mostly fixed, remainder is small
Since the last audit, env schemas (`baseEnvSchema`), CORS options, health route, error handler, limiter factories, and the RedisStore helper all moved into `@hallpass/express-middleware`. What's left: `auth.ts` is byte-identical ×2 (schools-api/passes-api), and each `app.ts` still hand-repeats the same helmet/CORS/httpLogger/json/health/limiter/notFound/errorHandler ordering (~40 lines ×3). A `createBaseApp(serviceName, env)` would close it out; low urgency now.

### 🟡 Cursor-pagination block: helper exists but isn't shared
passes-api extracted `paginate()` (`apps/passes-api/src/lib/pagination.ts`) and uses it twice, but users (`user.ts:164-166`), schools (`school.ts:36-38`), and districts (`district.ts:36-38`) still inline the same `take + 1`/slice/`nextCursor` block. Move `paginate()` into a shared package and use it everywhere.

### 🟡 Prisma error-code sniffing reimplemented four ways
`isUniqueViolation` (`passes.ts:81`), `isDuplicateEmailError` (`user.ts:88`), `isPinCodeConflict` (`apps/user-api/src/lib/pin.ts:14`), and inline P2003 checks ×3 (user PATCH, school create, school PATCH). One shared `isPrismaError(err, code, target?)` in the middleware package.

### 🟡 Naming and ordering nits
`requireSchool` (passes-api) vs `requireSchoolAccess` (schools-api) are different contracts with confusingly similar names; middleware order flips between routes (`validateBody` before `requireRole` on `POST /users`, after on `/bulk`).

### 🟡 `docs/ONBOARDING.md` documents a dead flow
Its primary "self-signup + promote" flow predates `disableSignUp: true` (commit 419544d) and contradicts `docs/AUTH.md` — sign-up now rejects with BAD_REQUEST. Only the temp-password path works. Update when onboarding work starts.

### 🟡 `docs/SCHEMA_PLAN.md` has drifted substantially from the code
It's labeled "source of truth before building", but a frontend dev reading it will be misled on several live contracts:
- `GET /passes` takes `?date=` defaulting to today per the doc; the code has `from`/`to` with **no** default — omits nothing, returns full history.
- Destination DELETE says "immediately expire all WAITING passes"; code instead 409-blocks when any PENDING/WAITING/ACTIVE pass exists (`destination.ts:112-119`).
- Documents Redis keys/mechanisms that were never built: `pass:current:{studentId}`, the `session:{token}` auth cache (every authed request does getSession + user lookup against Neon — relevant to SPA latency), the cold-start `slots:init` lock, and the whole BullMQ expiry section (replaced by in-process timers + reconcile sweep, per INFRA.md).
- Index strategy lists compound `Pass` indexes (`(schoolId,status)`, `(studentId,status)`, `(schoolId,status,createdAt)`, `(destinationId,status,createdAt)`, `(periodId,status)`); actual schema has single-column `schoolId`/`studentId`/`status` plus `(destinationId,status)` and no `periodId` index (`packages/db/prisma/schema.prisma` Pass model) — the doc's rationale queries (promotion, reconcile, teacher board) run on weaker indexes than documented.
- Prisma sketches use `String @default(cuid())` ids and old field names (`requestedById`, `issuedAt`, `createdAt`); real schema is Int serial with `requesterId`/`activatedAt`/`requestedAt`.
- The parent-lookup, PIN, and `GET /schedule/today` endpoints are absent from its API tables (INFRA.md covers them).

Mark the stale sections as historical or update them — cheaper than a support round-trip per misled reader.

---

## Suggested priority

1. Remaining DRY items (§3) opportunistically.

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
