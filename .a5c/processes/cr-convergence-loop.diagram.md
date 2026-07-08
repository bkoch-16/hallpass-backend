# CR Convergence Loop — Diagram

```
START
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  OUTER LOOP  (max 5 iterations, state in loop-state.json)       │
│                                                                  │
│  ┌──────────────────────────────────┐                           │
│  │  1. CODE REVIEW AGENT            │                           │
│  │  git diff develop...HEAD         │                           │
│  │  → cr-findings.json              │                           │
│  └──────────────┬───────────────────┘                           │
│                 │                                                │
│         done=true? ──────────────────────────────────────► DONE │
│                 │ done=false                                      │
│                 ▼                                                │
│  ┌──────────────────────────────────┐                           │
│  │  2. FIX PLANNING AGENT           │                           │
│  │  reads cr-findings.json          │                           │
│  │  → fix-plan-v1.json              │                           │
│  └──────────────┬───────────────────┘                           │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  3. APPROVAL LOOP  (max 3 re-plans)                      │   │
│  │                                                          │   │
│  │  ┌────────────────────────────┐                         │   │
│  │  │  APPROVAL AGENT            │                         │   │
│  │  │  reads findings + plan     │                         │   │
│  │  │  → approval-vN.json        │                         │   │
│  │  └─────────────┬──────────────┘                         │   │
│  │                │                                         │   │
│  │         approved?                                        │   │
│  │         YES ──────────────────────────────────► proceed │   │
│  │         NO  ─► both agents escalate? ─► YES ─► BREAKPT  │   │
│  │                        │ NO                              │   │
│  │                        ▼                                 │   │
│  │              replanCount < 3?                            │   │
│  │              YES ─► RE-PLAN AGENT → new fix-plan-vN+1   │   │
│  │                     └─────────────────────── (loop)     │   │
│  │              NO  ─► BREAKPT (exhausted)                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────┐                           │
│  │  4. IMPLEMENTATION AGENT         │                           │
│  │  reads fix-plan-vN.json          │                           │
│  │  applies changes to source       │                           │
│  │  → implementation.json           │                           │
│  └──────────────┬───────────────────┘                           │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  5. QUALITY GATES LOOP  (max 3 attempts)                 │   │
│  │                                                          │   │
│  │  ┌──────────────────────┐                               │   │
│  │  │  pnpm build          │                               │   │
│  │  │  pnpm lint           │  → quality-gates-attempt-N    │   │
│  │  │  pnpm test           │                               │   │
│  │  └──────────┬───────────┘                               │   │
│  │             │                                            │   │
│  │         passed?                                          │   │
│  │         YES ──────────────────────────────────► proceed │   │
│  │         NO + attempts left ─► FIX QUALITY AGENT         │   │
│  │                               └────────────── (loop)    │   │
│  │         NO + exhausted ─► BREAKPT                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                 │                                                │
│                 ▼                                                │
│  ┌──────────────────────────────────┐                           │
│  │  6. COMMIT  (git-commit skill)   │                           │
│  │  reads findings + implementation │                           │
│  │  commits all changes             │                           │
│  └──────────────┬───────────────────┘                           │
│                 │                                                │
│                 └──────────────────────────────────► LOOP BACK  │
└─────────────────────────────────────────────────────────────────┘

HUMAN ESCALATION rules:
  • Fires ONLY when BOTH the CR/approval agent AND the planning agent
    independently flag needsEscalation=true in the same re-plan cycle.
  • Also fires (informational) when re-plan or quality-gate limits are hit.

STATEFUL TRACKING (all state in .a5c/runs/<runId>/artifacts/):
  loop-state.json                         ← overall loop status, resumable
  iteration-N/cr-findings.json            ← CR findings
  iteration-N/fix-plan-vN.json            ← fix plan (versioned)
  iteration-N/approval-vN.json            ← approval decision (versioned)
  iteration-N/implementation.json         ← what was changed
  iteration-N/quality-gates-attempt-N.json← build/lint/test results
  iteration-N/quality-fix-attempt-N.json  ← quality fix summaries

No context is shared between agents or across iterations — each agent reads
from specific files and writes to specific files.
```
