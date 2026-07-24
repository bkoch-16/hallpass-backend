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

### 🟡 SUPER_ADMIN provisioning can't set `schoolId` — documented onboarding flow needs an undocumented second step *(2026-07-24 audit)*
`createUserSchema` has no `schoolId` field (`packages/types/src/schemas.ts:67-71`) and the create handlers spread `{}` for SUPER_ADMIN callers (`apps/user-api/src/routes/user.ts:248`, bulk at `:315`), so every SUPER_ADMIN-provisioned user lands with `schoolId: null` and must be attached via a follow-up `PATCH /users/:id { schoolId }` (itself SUPER_ADMIN-only). `docs/ONBOARDING.md:50-54` describes "a super-admin calls `POST /api/users` with `{ role: ADMIN }`" as the school-admin onboarding flow but never mentions the second step; if it's skipped, the resulting school-less ADMIN is 403'd from creating any users (`user.ts:227-230`). The SPA's onboarding screens will have to implement this two-request dance and handle the half-done state.

---

## 2. Security

### 🟡 Small items
- Soft-deleting a user now revokes its better-auth sessions on `DELETE /api/users/:id`, but the email row is still occupied forever — the user can never be re-provisioned (409). Email-reuse story is still undecided.
- `change-password` has no `email` in its body, so the strict auth limiter falls back to per-IP keying (`packages/middleware/src/rateLimit.ts:136-142`) — 10/15min shared across a school NAT for password changes.
- Provisioning now emails a 7-day set-password invite link (`apps/user-api/src/routes/user.ts:56-62`), but the `tempPassword` returned in the response itself still never expires and nothing forces a change on first login.
- `INTERNAL_SECRET` and `PARENT_TOOL_API_KEY` only require `min(1)` (`apps/passes-api/src/env.ts:12-13`, `apps/schools-api/src/env.ts:15`) — enforce a real minimum length. Note `PARENT_TOOL_API_KEY` is a single static, platform-wide credential: with it plus a student PIN, `GET /api/passes/parent-lookup` returns any student's pass history in any school, and the API-key path on the schools-api public GETs reads any school's calendar/schedule data. Acceptable for one trusted voice-AI caller, but there is no rotation story and no per-school scoping.
- No audit trail for admin actions (role changes, deletions). Eventually a K-12 compliance expectation; noted, not urgent.

### 🟠 Session tokens, cookies, and API keys are logged verbatim on every request *(2026-07-24 audit)*
`httpLogger` is `pinoHttp({ logger })` with no `redact` config or custom serializer (`packages/logger/src/index.ts:8`), and pino-http's default `req` serializer emits all request headers — verified against the installed pino-http 11.0.0: `authorization`, `cookie`, and `x-api-key` values all appear in the emitted log line. Consequences: every authenticated SPA/REST request writes the caller's live better-auth Bearer session token to Cloud Logging; every parent-tool call logs `PARENT_TOOL_API_KEY`; every scheduler call to `/internal/reconcile-expiry` logs `INTERNAL_SECRET` (it rides `Authorization: Bearer`, `apps/passes-api/src/routes/internal.ts:15-19`). Anyone with log-read access can replay sessions for their 7-day lifetime, and the static API keys never rotate. This directly contradicts the care taken in `packages/middleware/src/rateLimit.ts:47` ("hashed, so raw tokens never become store keys or hit logs").

**Fix:** `pino` `redact` paths (`req.headers.authorization`, `req.headers.cookie`, `req.headers["x-api-key"]`) in `@hallpass/logger`.

### 🟠 `PATCH /users/:id` email updates bypass better-auth's normalization — a mixed-case email bricks the account; duplicates return 500 *(2026-07-24 audit)*
The provisioning path lowercases email before insert (`packages/auth/src/index.ts:77`), and better-auth resolves sign-in / password-reset by exact-match on `email.toLowerCase()` (verified in 1.5.4, `dist/db/internal-adapter.mjs:439-447`). But the PATCH handler writes `req.body.email` verbatim (`apps/user-api/src/routes/user.ts:401-406`; `updateUserSchema` has no lowercase transform). So an admin PATCHing an email with any uppercase character stores a value better-auth's lookup can never find — the user can no longer sign in or reset their password, with no error at update time. Two adjacent gaps in the same handler: a duplicate email hits the case-sensitive `User.email` unique index as an uncaught P2002 (only P2003 is handled, `user.ts:408-413`) and surfaces to the SPA as a 500 instead of the 409 the POST path returns; and a case-variant of an existing email (`Foo@x.com` vs `foo@x.com`) passes the unique index entirely, planting two rows that both lowercase-collide. `emailVerified` is also left untouched on email change.

### 🟠 Live Socket.io connections outlive account deletion, demotion, and sign-out *(2026-07-24 audit)*
`socket.data.user` and room membership are fixed once at handshake (`apps/passes-api/src/lib/socket.ts:61-97`) and never re-validated. `DELETE /api/users/:id` soft-deletes the row and revokes better-auth sessions (`apps/user-api/src/routes/user.ts:448-463`) but nothing disconnects the user's live sockets — the REST plane correctly starts 401ing (per-request DB check in `resolveSessionUser`) while the realtime plane keeps streaming. A deleted or role-demoted staff account stays joined to `school:{id}` and continues receiving every pass event for the school (student names, notes, movement in real time) until the client itself disconnects; same for sign-out and for a SUPER_ADMIN moving a user between schools. Note the deletion happens on user-api while the sockets live on passes-api, so a fix needs either a cross-service signal (e.g. `io.in("user:{id}").disconnectSockets()` via the Redis adapter) or periodic session re-validation on live connections.

### 🟡 Role transitions don't manage `pinCode` *(2026-07-24 audit)*
Pins are only assigned at provisioning time (`assignPin`, `apps/user-api/src/routes/user.ts:60-65`, called from POST `/` and `/bulk`). `PATCH /users/:id { role: "STUDENT" }` writes the role change only (`user.ts:401-406`), so a user moved into STUDENT has `pinCode: null`, the "every student needs a unique pinCode" invariant (`apps/user-api/src/lib/pin.ts:5-7`) silently breaks, and the parent voice tool can never find them (`apps/passes-api/src/routes/passes.ts:360-362` filters `role: STUDENT`) — with no endpoint to assign or regenerate a pin after the fact. The inverse transition (STUDENT promoted away) harmlessly strands the pin but keeps occupying a unique slot.

### 🟡 No length caps on free-text fields *(2026-07-24 audit)*
`note`, `approverNote`, `denierNote` (`apps/passes-api/src/schemas/passes.ts:8,12,16`), calendar `note` (`packages/types/src/schemas.ts:55`), and every `name` field (users, schools, districts, destinations, schedule types, periods) are `z.string()` with `min(1)` at most — anything up to the express.json 100 KB default body limit is accepted, stored, then re-broadcast: pass notes ride `PASS_SELECT` into every REST list response and every `school:{id}` socket event (`apps/passes-api/src/lib/passResponse.ts:26-28`). A browser client will reasonably assume the server enforces sane bounds; today nothing does.

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
