# claude-usage-audit — flow diagram

```mermaid
flowchart TD
    Start([Start]) --> P1

    subgraph Phase1 [Phase 1 — Inventory]
        P1[shell: inventory-transcripts<br/>projects, sessions, sizes,<br/>date ranges, msg counts<br/>+ init claude-code-audit.md]
    end

    P1 --> Filter{projects with<br/>sessions > 0?}
    Filter -- none --> Fail([Fail: no transcripts])
    Filter -- ~11 projects --> Split[5 large projects → own agent<br/>6 small projects → 1 batch agent]
    Split --> P2

    subgraph Phase2 [Phase 2 — Analysis, ~6 tasks, waves of 4, largest first]
        P2[agent: analyze-projects ×4 parallel<br/>opening prompts, corrections,<br/>feature usage, notable quotes<br/>→ append interim to audit file]
        P2 --> MoreWaves{more<br/>units?}
        MoreWaves -- yes --> P2
    end

    MoreWaves -- no --> P3

    subgraph Phase3 [Phase 3 — Synthesis]
        P3[agent: synthesize-report<br/>6-section final report replaces interim<br/>every quote grep-verified]
    end

    P3 --> P4Score

    subgraph Phase4 [Phase 4 — Quality gate, max 2: score → refine → rescore]
        P4Score[agent: score-report<br/>section contract 30 + overview 10<br/>+ rewrites 20 + evidence 20<br/>+ tone 10 + features 10<br/>fabricated quote → cap 50]
        P4Score --> Gate{score ≥ 85?}
        Gate -- no, attempts left --> P4Refine[agent: refine-report<br/>fix flagged gaps only]
        P4Refine --> P4Score
    end

    Gate -- yes --> BP
    Gate -- no, attempts exhausted --> BP

    subgraph Phase5 [Phase 5 — Human review]
        BP{{breakpoint:<br/>review claude-code-audit.md}}
    end

    BP -- approved --> Done([Complete])
    BP -- rejected --> Done2([Revise per feedback])
```

## Task inventory

| Task | Kind | Fan-out |
|------|------|---------|
| `inventory-transcripts` | shell | 1 |
| `analyze-projects` | agent (general-purpose) | ~6 (5 large + 1 small batch, waves of 4) |
| `synthesize-report` | agent | 1 |
| `score-report` | agent | 1–2 |
| `refine-report` | agent | 0–1 |
| final review | breakpoint | 1 |
