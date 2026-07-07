# Tech Debt

Follow-ups from the code review of the `create-passes-service` branch (2026-07-01). Each item lists where it lives, why it matters, and the suggested fix. Items already fixed on that branch (back-to-back `gte` bug, nondeterministic period match, passes-api `/health` rate-limiting, return-path 500, dangling-school UTC fallback, socket room scoping/event contract + `fromNodeHeaders` reuse, empty-secret env validation, `GET /passes` pagination, import-extension alignment, deploy cache scopes, `Pass` soft-delete documentation, schools-api/user-api `/health` limiter ordering, `/internal` repeated-Authorization-header 500, `void Promise.resolve` wrapper) are not repeated here.

## Correctness / edge cases

### 1. Midnight edge-case family (passes-api)
Related to the review issue deliberately deferred during the passes-api review loop.
- `apps/passes-api/src/lib/time.ts:11` — `getCurrentTimeInTimezone` doesn't normalize a possible `"24:xx"` result from `Intl.DateTimeFormat` with `hour12: false`, while `localMidnightAsUTC` in the same file explicitly handles `rawH === 24`. At local midnight, `"24:00"` breaks the string comparisons in `timeLeq`.
- `apps/passes-api/src/routes/passes.ts` — a period starting just after midnight with a negative start buffer wraps `windowStart` to `23:xx` (`addMinutesToTime` wraps at 24 h), so the buffered window never matches and the pass is rejected with "No active period".
- `apps/passes-api/src/routes/internal.ts` — `/internal/reconcile-expiry` computes `periodEndDate` for *today*, so a stale ACTIVE pass from a previous day is rescheduled to expire at today's period end instead of immediately.

**Fix:** normalize `24:xx` → `00:xx` in `getCurrentTimeInTimezone`; clamp (don't wrap) buffered window starts; in reconcile, expire passes whose calendar date is before today instead of rescheduling them.

### 2. Redis slot-key TTL can briefly over-admit
`apps/passes-api/src/lib/slots.ts:5` — if a `slots:destination:<id>` or `slots:school:<id>` key expires while passes are ACTIVE, the next claim re-initializes it to `maxOccupancy`, temporarily over-admitting until `/internal/reconcile-expiry` runs. Documented tradeoff; acceptable while reconcile runs frequently.

**Fix (if it bites):** reconcile the counter from DB state inside the claim path when the key is missing, instead of initializing to max.

## DRY / structure

### 3. Middleware copy-pasted across three services and diverging — RESOLVED 2026-07-07
`middleware/auth.ts`, `middleware/roleGuard.ts`, `middleware/validate.ts`, `express.d.ts` are near-identical in user-api, schools-api, and passes-api — and already diverging (passes-api's `roleGuard` has `requireMinRole`; the others don't).

**Resolution:** extracted into `@hallpass/express-middleware` (`packages/middleware`) on the `refactor/middleware-package` branch — validate/health/errorHandler/express types, the full roleGuard superset, `createRequireAuth(auth)`, plus rate-limit factories, `baseEnvSchema`, and `parseCorsOrigins`. All three apps adopt it; leftover sweep confirmed one source of truth per module. Follow-ups from the extraction are items 8–11 below.

### 4. Calendar-date construction duplicated
`new Date(dateStr + "T00:00:00Z")` appears in `apps/passes-api/src/routes/passes.ts` and `apps/passes-api/src/lib/queue.ts`.

**Fix:** extract a helper in `src/lib/time.ts` (e.g. `calendarDate(dateStr)`).

---

Follow-ups from the second review of the branch (2026-07-01). The larger findings from that review (stale `PassResponse`/`CreatePassBody` contract types, BullMQ jobId dedup blocking reconcile recovery, Socket.io shutdown hang, socket auth duplicating `requireAuth` — both now share `apps/passes-api/src/lib/sessionUser.ts`) were fixed directly and are not listed here.

### 5. Redis connection construction repeated
`new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })` is hand-built three times: `apps/passes-api/src/lib/queue.ts` (queue + worker connections) and `apps/passes-api/src/lib/socket.ts` (adapter pub client).

**Fix:** add a factory in `src/lib/redis.ts` (e.g. `createBlockingRedis()`) that centralizes the connection options.

### 6. `env.ts` PORT schema divergence — RESOLVED 2026-07-07
passes-api validates `PORT` as `z.coerce.number().optional().default(3003)` while schools-api and user-api use `z.string().optional()`.

**Resolution:** all three apps now get `PORT` as `z.coerce.number().optional()` from `baseEnvSchema` in `@hallpass/express-middleware` (passes-api keeps its `.default(3003)` via `.extend()`). Note the intentional tightening: a non-numeric `PORT` in user-api/schools-api now fails env validation at boot instead of being passed through as a string.

## Tooling

### 7. Babysitter stop hook fires twice per session stop — RESOLVED 2026-07-06
The babysitter plugin's stop hook was registered twice (once via a manually added absolute-path entry in `~/.claude/settings.json`, once via the plugin's own `hooks.json` using `${CLAUDE_PLUGIN_ROOT}`), so every session stop ran it twice. The racing invocations wrote duplicate `STOP_HOOK_INVOKED` journal entries with the same sequence number under `.a5c/runs/<runId>/journal/`, corrupting the journal ("Journal sequence gap detected") until the duplicate file was deleted by hand. This happened on every stop during the 2026-07-02 CR convergence run (`01KWJM3X7DPJ1S8RR9GWK4GWTJ`) and again on run `01KWW5G9AXTF3S6ECSQHP1MR2W`.

**Resolution:** removed the manual duplicate Stop and SessionStart entries from `~/.claude/settings.json`; the plugin's `hooks.json` registration is the single source. A duplicate-journal-entry incident after 2026-07-06 would mean a regression (e.g. the manual entries were re-added or the SDK journal append is still not idempotent per sequence).

---

Follow-ups from the `@hallpass/express-middleware` extraction (`refactor/middleware-package`, 2026-07-07). The extraction itself resolved items 3 and 6 above; these are the items deliberately deferred during that run (details in `.a5c/runs/01KWWQDAM6J53YCZ0XET2AK5B6/artifacts/final-report.md`).

### 8. General rate limiter's per-user keying is latent
`packages/middleware/src/rateLimit.ts` — `createGeneralLimiter()` keys `user:{req.user.id}` with an IP fallback (the C2 fix), but all three apps mount the limiter in `app.ts` before any auth middleware runs, so `req.user` is never set at keying time and general traffic still keys per-IP — identical to pre-refactor behavior. Only the auth limiter's per-email keying is live today.

**Fix:** mount a limiter (or a second authed limiter) after `requireAuth` on protected routers in each app, or accept IP keying and amend the `createGeneralLimiter` JSDoc to say per-user keying only applies when `req.user` is populated upstream.

### 9. passes-api rate limiter still uses the in-memory store
The factories accept a `store` option (test-covered), but passes-api runs the default in-memory store — per-instance counters reset on restart and don't aggregate across instances. passes-api already has Redis (ioredis) but no express-rate-limit store adapter.

**Fix:** add `rate-limit-redis` to passes-api (new dependency — needs approval) and pass a store into the factories in `apps/passes-api/src/app.ts`; `REDIS_PREFIX` namespacing applies.

### 10. better-auth `trustedOrigins` cors parsing duplicated inline — RESOLVED 2026-07-07
`apps/user-api/src/auth.ts:7` and `apps/schools-api/src/auth.ts:7` still hand-roll the CORS_ORIGIN split/trim ternary for better-auth `trustedOrigins`, duplicating the package's `parseCorsOrigins` split logic (passes-api's `auth.ts` already delegates to it; its `'*'` branch legitimately differs because better-auth wants `undefined` for wildcard). Behavior-neutral duplication.

**Resolution:** both files now delegate to `parseCorsOrigins` with the same `'*'` → `undefined` mapping passes-api uses; behavior is unchanged.

### 11. Committed curl cookie file with a session token — RESOLVED 2026-07-07
`apps/user-api/src/middleware/student-cookies.txt` — a curl cookie jar containing a session token, committed since the initial commit (`728fbe2`). Predates the middleware refactor; surfaced by its leftover sweep.

**Resolution:** deleted the file. Checked the leaked token against the local dev DB's `Session` table — no matching row exists, so there was nothing to invalidate.

### 12. Mock-ordering fragility in user-api route tests
`apps/user-api/tests/routes/user.test.ts` — tests layer `mockResolvedValueOnce` chains on the shared `mockPrisma.user.findFirst` on top of the persistent `mockResolvedValue` set by `authenticateAs()`, so any extra `findFirst` call silently shifts the `Once` queue and intermittently flips assertions. Observed flake signatures: `DELETE /api/users/5` 403→404, and the prisma-throw case 500→200, during the 2026-07-07 tech-debt run.

**Fix:** make each test's mock sequence self-contained (e.g. use `mockImplementation` keyed on call args, or reset and rebuild the full mock chain per test) instead of stacking `Once` values over the shared persistent mock.
