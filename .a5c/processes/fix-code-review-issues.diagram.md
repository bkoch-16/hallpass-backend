# Process Diagram: fix-code-review-issues

```
START
  │
  ├──────────────────────────────────────────────────────────────────────────────┐
  │  PHASE 1 (parallel — 4 disjoint file groups)                                 │
  │                                                                              │
  │  ┌──────────────────────────┐  ┌──────────────────────────┐                 │
  │  │ fixSlotsTask (agent)     │  │ fixQueueTask (agent)      │                 │
  │  │                          │  │                           │                 │
  │  │ slots.ts + slots.test.ts │  │ queue.ts + queue.test.ts  │                 │
  │  │  #2 Lua TTL renewal      │  │  #3 pass-day calendar     │                 │
  │  │  #4 promotion race retry │  │  #9 period select narrow  │                 │
  │  │  #7 negative counter     │  │                           │                 │
  │  └──────────────────────────┘  └──────────────────────────┘                 │
  │                                                                              │
  │  ┌──────────────────────────┐  ┌──────────────────────────┐                 │
  │  │ fixServerTask (agent)    │  │ fixInfraTask (agent)      │                 │
  │  │                          │  │                           │                 │
  │  │ internal.ts + index.ts   │  │ deploy.yml + app.ts       │                 │
  │  │  #5 timingSafeEqual      │  │             + socket.ts   │                 │
  │  │  #6 SIGTERM shutdown     │  │  #8 GHA cache scopes      │                 │
  │  │                          │  │  #10 env.CORS_ORIGIN      │                 │
  │  └──────────────────────────┘  └──────────────────────────┘                 │
  │                                                                              │
  └──────────────────────────────────────────────────────────────────────────────┘
  │
  ↓  (all 4 tasks complete)
  │
  │  PHASE 2 — convergence loop (max 3 iterations)
  │
  │  ┌──────────────────────────────────────────────────────┐
  │  │ buildAndTestTask (shell)                             │
  │  │                                                      │
  │  │ pnpm --filter @hallpass/passes-api build             │
  │  │ pnpm --filter @hallpass/passes-api test run          │
  │  └───────────────────────────┬──────────────────────────┘
  │                              │
  │                   passed?    │
  │               YES ◄──────────┤
  │                              │ NO (and iterations < 3)
  │                              ↓
  │             ┌────────────────────────────────────┐
  │             │ fixBuildErrorsTask (agent)          │
  │             │                                    │
  │             │ • Read error output                │
  │             │ • Fix TypeScript / test issues     │
  │             │ • Re-enter loop                    │
  │             └──────────────┬─────────────────────┘
  │                            │
  │                            └──────────────────────► (retry buildAndTestTask)
  │
  ↓
  │
  │  PHASE 3 — breakpoint (moderate user)
  │  ┌──────────────────────────────────────────────────────────────────┐
  │  │ BREAKPOINT: "Review Fixes Before Commit"                         │
  │  │                                                                  │
  │  │ Lists all 9 files changed, confirms build/tests pass.           │
  │  │ User approves to mark complete, or rejects to keep reviewing.   │
  │  └──────────────────────────────────────────────────────────────────┘
  │
  ↓
END → { success: boolean, iterations: number }
```

## Parallel Strategy

Phase 1 runs all 4 fix tasks concurrently because they touch completely disjoint files:
- `fixSlotsTask`  → `slots.ts`, `slots.test.ts`
- `fixQueueTask`  → `queue.ts`, `queue.test.ts`
- `fixServerTask` → `internal.ts`, `index.ts`
- `fixInfraTask`  → `deploy.yml`, `app.ts`, `socket.ts`

No ordering dependency between them. Build+test must happen after all fixes are applied.

## Issue → File Mapping

| Issue | Severity | File(s) | Phase 1 Task |
|-------|----------|---------|--------------|
| #2 Lua TTL renewal | MED | `lib/slots.ts` | fixSlotsTask |
| #3 Pass-day calendar | MED | `lib/queue.ts` | fixQueueTask |
| #4 Promotion race retry | MED | `lib/slots.ts` | fixSlotsTask |
| #5 timingSafeEqual | MED | `routes/internal.ts` | fixServerTask |
| #6 SIGTERM shutdown | LOW | `src/index.ts` | fixServerTask |
| #7 Negative counter | LOW | `lib/slots.ts` | fixSlotsTask |
| #8 GHA cache scopes | LOW | `.github/workflows/deploy.yml` | fixInfraTask |
| #9 period over-fetch | LOW | `lib/queue.ts` | fixQueueTask |
| #10 corsOrigins fragile | LOW | `app.ts`, `lib/socket.ts` | fixInfraTask |
