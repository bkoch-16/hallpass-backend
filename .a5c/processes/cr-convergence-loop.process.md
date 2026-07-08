# CR Convergence Loop — Process Description

## Goal

Run an autonomous code-review → fix → verify loop until the codebase is clean.
The loop terminates when the CR agent finds nothing worth changing.
Human input is only requested when both agents independently agree it's needed.

## Loop Shape

Each iteration runs these phases in order:

### 1. Code Review (fresh agent)
- Diffs `develop...HEAD`
- Reviews for correctness, DRY violations, and idiomatic pattern deviations
- Writes structured findings to `iteration-N/cr-findings.json`
- If `done=true` (no findings) → loop exits successfully

### 2. Fix Planning (fresh agent)
- Reads `cr-findings.json` only — no other context
- Produces a file-level, code-specific fix plan
- Writes to `iteration-N/fix-plan-v1.json`

### 3. Approval Loop (fresh agent each check, max 3 re-plans)
- Approval agent reads CR findings + fix plan independently
- Approves only when every finding is concretely and correctly addressed
- On rejection: re-plan agent revises with feedback → re-approval
- **Escalation to human**: only when BOTH the approval agent AND the planning agent
  set `needsEscalation=true` in the same cycle — indicating a genuine architectural
  disagreement that neither agent can resolve autonomously
- If re-plan limit exhausted without agreement → human breakpoint

### 4. Implementation (fresh agent)
- Reads only the approved fix plan — no other context
- Applies changes surgically (no scope creep)
- Writes summary to `iteration-N/implementation.json`

### 5. Quality Gates (fresh agent each run, max 3 fix attempts)
- Runs `pnpm build`, `pnpm lint`, `pnpm test` in sequence
- On failure: fix-quality agent reads the error output and applies targeted fixes
- Re-runs the suite to verify
- If still failing after 3 attempts → human breakpoint

### 6. Commit
- Uses the `git-commit` skill
- Reads CR findings + implementation summary to build the commit message
- Stages and commits all changes (no AI attribution in message)

→ Loop back to step 1

## Configuration

| Parameter | Value |
|-----------|-------|
| Base branch | `develop` |
| Max outer iterations | 5 |
| Max re-plan attempts per iteration | 3 |
| Max quality-gate fix attempts | 3 |
| Auto-commit after each iteration | Yes (git-commit skill) |
| Human escalation condition | Both agents flag `needsEscalation=true` |

## Stateful Tracking

All state is written to `.a5c/runs/<runId>/artifacts/`:

```
loop-state.json                           ← overall status (pauseable/resumable)
iteration-N/cr-findings.json              ← CR agent findings
iteration-N/fix-plan-vN.json              ← fix plan, versioned per re-plan
iteration-N/approval-vN.json              ← approval decision per version
iteration-N/implementation.json           ← implementation summary
iteration-N/quality-gates-attempt-N.json  ← build/lint/test results
iteration-N/quality-fix-attempt-N.json    ← quality fix summaries
```

**No context is shared between agents or across iterations.** Each agent task
is given only file paths to read — not the content of previous agents' results.
This ensures the loop can be paused, resumed, or migrated across sessions cleanly.

## Termination

- **Success**: CR agent sets `done=true` — nothing left to fix
- **Max iterations**: Ran 5 full iterations without converging (rare)
- **User rejection at breakpoint**: User rejects a human escalation
- **Quality gates failure**: User rejects continuing after exhausted fix attempts

## How to Run

```bash
# From the repository root
babysitter run:create \
  --process-id cr-convergence-loop \
  --entry .a5c/processes/cr-convergence-loop.js#process \
  --prompt "Run the CR convergence loop until the branch is clean" \
  --harness claude-code \
  --plugin-root "$HOME/.claude/plugins/cache/a5c-ai/babysitter/<version>" \
  --json
```
