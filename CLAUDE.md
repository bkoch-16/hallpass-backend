## Planning

If asked to make a plan or how to solve a problem, switch to plan mode. Before planning, always read tests first to understand contracts before touching implementation.
Search for existing patterns before proposing new ones — never reinvent something that exists.
Do not explore files outside the scope of the task. Map first, then read only what's relevant.
Check package.json before suggesting new dependencies.

When a plan already exists and new instructions arrive, assess the impact before acting:
- **Discard**: New instructions change the goal or approach fundamentally — start a fresh plan.
- **Edit**: New instructions refine, constrain, or extend the existing plan — update only affected sections.
- **Keep**: New instructions are unrelated or confirm the current plan — leave it unchanged.

## Subagents

Each subagent should have a focused, scoped question. Never spawn a subagent for broad exploration.
Prefer parallel focused agents over sequential broad ones.

## Reference
Project docs are in /docs. Read relevant docs before starting any task.

## Babysitter

This project uses [babysitter](https://github.com/a5c-ai/babysitter) for orchestrated multi-step workflows.

**Invoke babysitter for:**
- Feature development with TDD: `/babysitter:call implement <feature> using TDD`
- Schema/API changes: `/babysitter:call add <endpoint> to <service>`
- PR reviews: `/babysitter:call review the current PR`
- Bug investigation: `/babysitter:call investigate and fix <issue>`

**Key constraints:**
- Babysitter may commit locally but must NOT push or open PRs without explicit user approval
- No CI/CD integration — do not trigger GitHub Actions workflows autonomously
- Always run `pnpm --filter @hallpass/db exec prisma migrate deploy` after schema changes
- Use `pnpm --filter <app>` to scope commands to a single service

**Project profile:** `.a5c/project-profile.json`