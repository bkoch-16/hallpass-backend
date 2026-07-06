# Process: fix-code-review-issues

Fix 9 bugs identified in the `create-passes-service` code review of `apps/passes-api/`.

## What this process does

Applies all 9 fixes autonomously in parallel, verifies the result with a build + test loop, then pauses for a single human review before you commit.

## Phases

### Phase 1 — Apply fixes (parallel, ~2 min)

Four agent tasks run concurrently, each touching a disjoint set of files:

| Task | Files | Issues |
|------|-------|--------|
| `fixSlotsTask` | `lib/slots.ts` + `tests/lib/slots.test.ts` | #2 Lua TTL, #4 race retry, #7 negative counter |
| `fixQueueTask` | `lib/queue.ts` + `tests/lib/queue.test.ts` | #3 pass-day calendar, #9 period over-fetch |
| `fixServerTask` | `routes/internal.ts` + `src/index.ts` | #5 timingSafeEqual, #6 SIGTERM shutdown |
| `fixInfraTask` | `.github/workflows/deploy.yml` + `app.ts` + `lib/socket.ts` | #8 GHA cache scopes, #10 corsOrigins |

Each task receives a precise description of the current code, the expected fix, and test cases to add. No task overlaps with another.

### Phase 2 — Build + test convergence (max 3 attempts)

Runs `pnpm --filter @hallpass/passes-api build` and `pnpm --filter @hallpass/passes-api test run`. If either fails, a convergence agent reads the error output and applies a targeted fix, then retries. Up to 3 attempts before pausing at the breakpoint with the failure output.

### Phase 3 — Breakpoint: human review

Presents a summary of all changed files and the build/test result. Approve to mark complete, or reject to keep working.

## What it does NOT do

- Does not commit or push.
- Does not migrate the database.
- Does not deploy.
- Does not fix issue #1 (addMinutesToTime midnight edge case — deferred).

## Inputs

None required. The process is hard-coded to the passes-api fixes identified in the code review.

## Outputs

```json
{ "success": boolean, "iterations": number }
```

- `success`: whether build + tests passed before the breakpoint
- `iterations`: how many build/test attempts were needed (1 = first try)

## Why this grouping

The 4 file groups have zero overlap, so parallel application is safe. TypeScript's build step catches inter-file type errors, which is why verification happens after all fixes are applied rather than per-task.

The convergence loop (max 3) handles the most common post-fix failure: a narrowed type on the `period` select causing a type error in a call site that still expects the full `Period` shape.
