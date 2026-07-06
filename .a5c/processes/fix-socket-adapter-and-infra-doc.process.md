# Process: fix-socket-adapter-and-infra-doc

Fixes two issues identified in the passes-api code review on `create-passes-service`.

---

## What this process fixes

### Issue #1 — Socket.io Redis adapter missing (correctness, must fix)

**Problem:** `apps/passes-api/src/lib/socket.ts` creates a Socket.io `Server` with no adapter.
Cloud Run auto-scales to multiple instances. A `pass:approved` event emitted on instance A
never reaches a client connected to instance B — they each have an isolated namespace.

**Fix:** Add `@socket.io/redis-adapter` and wire it with a dedicated pub/sub Redis connection
pair (`pubClient` + `subClient.duplicate()`). Events are then routed through Upstash Redis pub/sub
and reach all instances. No infrastructure change needed — the existing `REDIS_URL` is reused.

Files changed:
- `apps/passes-api/package.json` — add `@socket.io/redis-adapter` dependency
- `apps/passes-api/src/lib/socket.ts` — attach adapter inside `initSocket()`
- `apps/passes-api/tests/lib/socket.test.ts` — mock `ioredis` + `@socket.io/redis-adapter`

### Issue #2 — INTERNAL_SECRET missing from INFRA.md (documentation, must fix)

**Problem:** `apps/passes-api/src/env.ts` declares `INTERNAL_SECRET: z.string()` as a required
env var (used to authenticate `/internal/reconcile-expiry`). The `docs/INFRA.md` env var table
for passes-api lists 6 vars but omits it. Ops will miss it when provisioning the Cloud Run service.

**Fix:** Add the missing row to the table between `CORS_ORIGIN` and `PORT`.

Files changed:
- `docs/INFRA.md` — add `INTERNAL_SECRET` row

---

## Phases

| # | Phase | Agent/Shell | Output |
|---|-------|-------------|--------|
| 1a | Fix INFRA.md | agent | `docs/INFRA.md` updated |
| 1b | Wire adapter + update test | agent | `package.json`, `socket.ts`, `socket.test.ts` updated |
| 2 | Install deps | shell | `pnpm-lock.yaml` updated |
| 3 | Build + test (loop ≤ 3) | shell → agent | TypeScript and unit tests pass |
| 4 | Breakpoint: review | human | Approval to mark complete |

Phases 1a and 1b run in parallel (disjoint files, no ordering dependency).

---

## Convergence loop (Phase 3)

The build+test step may need 1-2 iterations to fix:
- Missing type declarations for the adapter package
- Mock structure for `ioredis.duplicate()` or `createAdapter` return shape in the test
- TypeScript ESM `.js` import path issues

The `fixBuildErrorsTask` agent reads the exact error output and makes targeted fixes.
Max 3 iterations before surfacing to the user via the breakpoint.

---

## Profile considerations

- **breakpointTolerance: moderate** → one breakpoint at the end (after verification)
- **alwaysBreakOn**: no deploy, migration, or destructive git ops in this process
- **gitCommits: true** (permissions) but NOT included in this process — user commits manually
- **autonomyLevel: semi-autonomous** → the agent applies all changes; the user reviews at the end
