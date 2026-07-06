# Process Diagram: fix-socket-adapter-and-infra-doc

```
START
  │
  ├──────────────────────────────────────────────────────────┐
  │  PHASE 1 (parallel)                                       │
  │                                                           │
  │  ┌─────────────────────────────┐  ┌──────────────────────┴───────────────────┐
  │  │ fixInfraDocTask (agent)     │  │ wireSocketAdapterTask (agent)             │
  │  │                             │  │                                           │
  │  │ • Read docs/INFRA.md        │  │ • Add @socket.io/redis-adapter to         │
  │  │ • Insert INTERNAL_SECRET    │  │   apps/passes-api/package.json            │
  │  │   row in env var table      │  │ • Update socket.ts: import createAdapter, │
  │  │   (between CORS_ORIGIN      │  │   create pubClient + subClient, attach    │
  │  │   and PORT rows)            │  │   io.adapter(createAdapter(pub, sub))     │
  │  └─────────────────────────────┘  │ • Update socket.test.ts: add vi.mock for  │
  │                                   │   ioredis and @socket.io/redis-adapter    │
  │                                   └───────────────────────────────────────────┘
  │
  ↓  (both tasks complete)
  │
  │  PHASE 2
  │  ┌─────────────────────────────┐
  │  │ installDepsTask (shell)     │
  │  │                             │
  │  │ pnpm install                │
  │  │ (pulls redis-adapter pkg)   │
  │  └─────────────────────────────┘
  │
  ↓
  │
  │  PHASE 3 — convergence loop (max 3 iterations)
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │ buildAndTestTask (shell)                                 │
  │  │                                                         │
  │  │ pnpm --filter @hallpass/passes-api build                │
  │  │ pnpm --filter @hallpass/passes-api test run             │
  │  └─────────────────────┬───────────────────────────────────┘
  │                         │
  │               passed?   │
  │           YES ◄─────────┤
  │                         │ NO (and iterations < 3)
  │                         ↓
  │          ┌──────────────────────────────────┐
  │          │ fixBuildErrorsTask (agent)        │
  │          │                                  │
  │          │ • Read error output              │
  │          │ • Fix TypeScript / mock issues   │
  │          │ • Re-enter loop                  │
  │          └──────────────┬───────────────────┘
  │                         │
  │                         └──────────────────────► (retry buildAndTestTask)
  │
  ↓
  │
  │  PHASE 4 — breakpoint (moderate user)
  │  ┌────────────────────────────────────────────────────────────────┐
  │  │ BREAKPOINT: "Review Changes Before Commit"                     │
  │  │                                                                │
  │  │ Lists all files changed, confirms build/tests pass.           │
  │  │ User approves to mark complete, or rejects to keep reviewing. │
  │  └────────────────────────────────────────────────────────────────┘
  │
  ↓
END → { success: boolean, iterations: number }
```

## Parallel Strategy

Phase 1 runs both fix tasks concurrently because they touch completely disjoint files:
- `fixInfraDocTask` → `docs/INFRA.md` only
- `wireSocketAdapterTask` → `package.json`, `socket.ts`, `socket.test.ts`

No ordering dependency between them. `pnpm install` must happen after both complete
(after `package.json` is updated).
