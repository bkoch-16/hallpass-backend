# claude-usage-audit

Audits the user's Claude Code usage from session transcripts in `~/.claude/projects/`
(one subdirectory per project, JSONL session files) and produces a direct, critical
report at `claude-code-audit.md`.

**Status: planned only — no run has been created.**
To execute: `/babysitter:call` referencing this process, or
`babysitter run:create --process-id claude-usage-audit --entry <abs-path>/.a5c/processes/claude-usage-audit.js#process --harness claude-code ...`

## Goal

Answer: "how can this user become a stronger Claude Code user?" — with evidence,
not encouragement. The report contract (scored by the quality gate):

1. **Usage overview** — sessions, projects, time span, typical session length
2. **Top 3 strengths** — with concrete quoted examples from transcripts
3. **Top 3 growth areas** — each with evidence and a specific habit change
4. **5 real prompts rewritten** — before (verbatim quote) / after
5. **Underused features** — plan mode, CLAUDE.md, slash commands, subagents, hooks, MCP — and where they would have helped
6. **Recurring correction patterns** — what context is consistently left out of first prompts

## Data profile (measured 2026-07-02)

13 project directories, ~142 sessions, 155MB total. Largest:
`hallpass-backend` (52MB, 41 sessions), `crewlab2` (40MB, 26), `crewlab3` (30MB, 18).
Whole-file reads are prohibited — analysis agents use grep/jq sampling only.

## Phases

| # | Phase | Kind | Notes |
|---|-------|------|-------|
| 1 | Inventory | shell | Enumerate projects/sessions, sizes, first/last timestamps, user-message counts; initialize the audit file |
| 2 | Analysis | agent ×~6 | One agent per **large** project (>10 sessions, currently 5); all small projects batched into a single agent. Parallel waves of 4, largest first. Extracts opening prompts, correction events (`no/actually/instead/undo/…`), feature usage. **Appends interim findings to the audit file** so nothing is lost to compaction |
| 3 | Synthesis | agent | Cross-project final report replaces interim content; every quote grep-verified before inclusion |
| 4 | Quality gate | agent loop | Scorer checks the 6-section contract + spot-checks 5 quotes against transcripts (fabricated quote caps score at 50). Threshold 85, max 2 iterations (score → one refine → rescore), refiner fixes flagged gaps only |
| 5 | Review | breakpoint | Single human approval of the final report (moderate breakpoint tolerance per user profile) |

**Quota trims (chosen by the user 2026-07-02):** ~8–10 subagent runs instead of
14–17 — small projects share one analysis agent, and the quality loop is capped
at a single refinement.

## Key design decisions

- **Interim writes to `claude-code-audit.md`** per the user's explicit instruction —
  each project agent appends its section immediately; synthesis replaces the file
  with the final report plus a per-project appendix.
- **Quote verification is a hard gate** — the most likely failure mode of an
  LLM-written audit is plausible-but-fabricated "quotes". Both the synthesis and
  scorer tasks must `grep -rF` distinctive substrings before/after inclusion.
- **Critical tone is scored**, not just requested — praise padding and generic
  advice untied to evidence are explicit deductions.
- **Privacy** — transcripts are private; every agent task carries a local-only
  constraint (no WebSearch/WebFetch, no external services).
- **Correction semantics** — a prompt that "worked" after three clarifying rounds
  counts as a first-prompt failure; grep hits like "no tests exist" are filtered
  as false positives by the analysis agent.

## Inputs

| Input | Default |
|-------|---------|
| `projectsDir` | `/Users/bkoch/.claude/projects` |
| `outputFile` | `/Users/bkoch/development/hallpass-backend/claude-code-audit.md` |
| `qualityThreshold` | 85 |
| `maxRefineIterations` | 2 |
| `smallProjectMaxSessions` | 10 |
