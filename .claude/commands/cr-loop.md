Run the CR convergence loop babysitter process on the current branch:

```bash
AGENT_SESSION_ID="$CLAUDE_CODE_SESSION_ID" AGENT_TRUST_ENV_SESSION=1 babysitter run:create \
  --process-id cr-convergence-loop \
  --entry /Users/bkoch/development/hallpass-backend/.a5c/processes/cr-convergence-loop.js#process \
  --prompt "Run the CR convergence loop until the branch is clean" \
  --harness claude-code \
  --runs-dir /Users/bkoch/development/hallpass-backend/.a5c/runs \
  --plugin-root "/Users/bkoch/.claude/plugins/cache/a5c-ai/babysitter/4.0.150" \
  --json
```

Then invoke the babysitter:babysit skill and follow its instructions to drive the orchestration loop.
