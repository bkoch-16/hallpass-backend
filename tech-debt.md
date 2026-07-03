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

### 3. Middleware copy-pasted across three services and diverging
`middleware/auth.ts`, `middleware/roleGuard.ts`, `middleware/validate.ts`, `express.d.ts` are near-identical in user-api, schools-api, and passes-api — and already diverging (passes-api's `roleGuard` has `requireMinRole`; the others don't).

**Fix:** promote to a shared workspace package (e.g. `@hallpass/express-middleware`) before a fourth service appears.

### 4. Calendar-date construction duplicated
`new Date(dateStr + "T00:00:00Z")` appears in `apps/passes-api/src/routes/passes.ts` and `apps/passes-api/src/lib/queue.ts`.

**Fix:** extract a helper in `src/lib/time.ts` (e.g. `calendarDate(dateStr)`).

---

Follow-ups from the second review of the branch (2026-07-01). The larger findings from that review (stale `PassResponse`/`CreatePassBody` contract types, BullMQ jobId dedup blocking reconcile recovery, Socket.io shutdown hang, socket auth duplicating `requireAuth` — both now share `apps/passes-api/src/lib/sessionUser.ts`) were fixed directly and are not listed here.

### 5. Redis connection construction repeated
`new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })` is hand-built three times: `apps/passes-api/src/lib/queue.ts` (queue + worker connections) and `apps/passes-api/src/lib/socket.ts` (adapter pub client).

**Fix:** add a factory in `src/lib/redis.ts` (e.g. `createBlockingRedis()`) that centralizes the connection options.

### 6. `env.ts` PORT schema divergence
passes-api validates `PORT` as `z.coerce.number().optional().default(3003)` while schools-api and user-api use `z.string().optional()`.

**Fix:** align all three on the coerce-number form when the shared middleware package (item 3) is extracted.
