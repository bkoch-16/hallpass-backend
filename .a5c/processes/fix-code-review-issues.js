/**
 * @process fix-code-review-issues
 * @description Fix 9 issues identified in the passes-api code review on create-passes-service.
 *
 * Issues addressed (skipping #1 — midnight edge case deferred):
 *   #2  MEDIUM — LUA_RELEASE_SLOT doesn't renew TTL on normal INCR path (slots.ts)
 *   #3  MEDIUM — checkIsLastPeriod queries today's calendar, not the pass's day (queue.ts)
 *   #4  MEDIUM — Promotion race loser doesn't retry for the next WAITING pass (slots.ts)
 *   #5  MEDIUM — INTERNAL_SECRET compared with !== not timingSafeEqual (internal.ts)
 *   #6  LOW    — Worker return value discarded; no SIGTERM shutdown (index.ts)
 *   #7  LOW    — reconcileSlots can write a negative counter (slots.ts)
 *   #8  LOW    — Dev and prod share GHA Docker cache scope (deploy.yml)
 *   #9  LOW    — period: true over-fetches in processPassExpiry (queue.ts)
 *   #10 LOW    — corsOrigins !== "*" fragile (app.ts, socket.ts)
 *
 * Phases:
 *   1 — Apply fixes in parallel (4 tasks, disjoint file sets)
 *   2 — Build + test convergence loop (max 3 attempts)
 *   3 — Breakpoint: human review before commit
 *
 * Profile: intermediate TS/Node.js user, semi-autonomous, moderate breakpoint tolerance.
 * No deploy or migration steps — no alwaysBreakOn triggers.
 *
 * @skill growing-outside-in-systems specializations/backend-development/skills/growing-outside-in-systems/SKILL.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';
import { buildAndTestTask, makeFixBuildErrorsTask } from './shared/passes-api-build-tasks.js';

export async function process(inputs, ctx) {
  const projectRoot = '/Users/bkoch/development/hallpass-backend';
  const MAX_FIX_ITERATIONS = 3;

  // ============================================================================
  // PHASE 1 — Apply fixes in parallel (4 disjoint file groups)
  // ============================================================================

  ctx.log('info', 'Phase 1: Applying all fixes in parallel');

  await ctx.parallel.all([
    () => ctx.task(fixSlotsTask, { projectRoot }),
    () => ctx.task(fixQueueTask, { projectRoot }),
    () => ctx.task(fixServerTask, { projectRoot }),
    () => ctx.task(fixInfraTask, { projectRoot }),
  ]);

  // ============================================================================
  // PHASE 2 — Build + test convergence loop (max 3 iterations)
  // ============================================================================

  ctx.log('info', 'Phase 2: Build and test verification');

  let iteration = 0;
  let verified = false;
  let lastOutput = '';

  while (iteration < MAX_FIX_ITERATIONS && !verified) {
    iteration++;

    const result = await ctx.task(buildAndTestTask, {
      projectRoot,
      attempt: iteration,
    });

    lastOutput = result.output ?? '';
    verified = result.passed === true;

    if (!verified && iteration < MAX_FIX_ITERATIONS) {
      ctx.log('warn', `Attempt ${iteration} failed — running convergence fix`);
      await ctx.task(fixBuildErrorsTask, {
        projectRoot,
        testOutput: lastOutput,
        iteration,
      });
    }
  }

  // ============================================================================
  // PHASE 3 — Breakpoint: human review before commit
  // ============================================================================

  const summary = verified
    ? `All 9 fixes applied and verified (${iteration === 1 ? 'first try' : `after ${iteration - 1} fix(es)`}).`
    : `Verification still failing after ${MAX_FIX_ITERATIONS} attempts. Last output tail:\n\n${lastOutput.slice(-400)}`;

  await ctx.breakpoint({
    question: verified
      ? [
          summary,
          '',
          'Files changed:',
          '  • apps/passes-api/src/lib/slots.ts       — #2 Lua TTL renewal, #4 promotion race retry, #7 negative counter guard',
          '  • apps/passes-api/tests/lib/slots.test.ts — updated unit tests for above',
          '  • apps/passes-api/src/lib/queue.ts        — #3 pass-day calendar lookup, #9 period select narrowing',
          '  • apps/passes-api/tests/lib/queue.test.ts — updated unit tests for above',
          '  • apps/passes-api/src/routes/internal.ts  — #5 timingSafeEqual for INTERNAL_SECRET',
          '  • apps/passes-api/src/index.ts            — #6 SIGTERM worker shutdown',
          '  • apps/passes-api/src/app.ts              — #10 env.CORS_ORIGIN !== "*"',
          '  • apps/passes-api/src/lib/socket.ts       — #10 env.CORS_ORIGIN !== "*"',
          '  • .github/workflows/deploy.yml            — #8 distinct cache scopes per environment',
          '',
          'Build and unit tests pass. Approve to mark complete, or reject to keep reviewing.',
        ].join('\n')
      : `${summary}\n\nHow would you like to proceed?`,
    title: verified ? 'Review Fixes Before Commit' : 'Verification Failed — Review Required',
    context: { runId: ctx.runId },
  });

  return { success: verified, iterations: iteration };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

// ─── Phase 1a: slots.ts fixes (#2, #4, #7) ──────────────────────────────────

const fixSlotsTask = defineTask('fix-slots', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix slots.ts: Lua TTL renewal (#2), promotion race retry (#4), negative counter (#7)',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript/Redis backend engineer fixing correctness bugs in a slot-management module',
      task: 'Apply three targeted fixes to apps/passes-api/src/lib/slots.ts and update the corresponding unit tests in apps/passes-api/tests/lib/slots.test.ts.',
      context: {
        projectRoot: args.projectRoot,
        filesToModify: [
          'apps/passes-api/src/lib/slots.ts',
          'apps/passes-api/tests/lib/slots.test.ts',
        ],
        fixes: {
          issue2_lua_ttl: {
            description: 'LUA_RELEASE_SLOT does not renew TTL on the normal INCR path',
            currentCode: `const LUA_RELEASE_SLOT = \`
local key = KEYS[1]
local max = tonumber(ARGV[1])
local val = redis.call('INCR', key)
if val > max then
  redis.call('SET', key, max, 'EX', 86400)
  return max
end
return val
\`;`,
            fix: `Add 'redis.call("EXPIRE", key, 86400)' BEFORE the final 'return val' line so the TTL is refreshed on every release, not just when capping. The corrected Lua should be:
local key = KEYS[1]
local max = tonumber(ARGV[1])
local val = redis.call('INCR', key)
if val > max then
  redis.call('SET', key, max, 'EX', 86400)
  return max
end
redis.call('EXPIRE', key, 86400)
return val`,
          },
          issue4_promotion_race: {
            description: 'promoteFromQueue returns without retrying after losing a concurrent promotion race',
            currentCode: `if (count === 0) {
  // Another worker already promoted this pass — release the slot we claimed
  await releaseSlot(destinationId, maxOccupancy);
  return;
}`,
            fix: `After releaseSlot, retry promoteFromQueue once more (do NOT recurse infinitely — one retry is enough to pick up the next WAITING pass that the winning worker's pass vacated). Pass a second boolean argument 'isRetry' to guard against infinite recursion:

export async function promoteFromQueue(
  destinationId: number,
  maxOccupancy: number | null,
  _isRetry = false,
): Promise<void> {
  ...
  if (count === 0) {
    await releaseSlot(destinationId, maxOccupancy);
    if (!_isRetry) {
      await promoteFromQueue(destinationId, maxOccupancy, true);
    }
    return;
  }
  ...
}

Update all call sites (releaseAndPromote and anywhere else promoteFromQueue is called) to NOT pass the third argument (it defaults to false).`,
          },
          issue7_negative_counter: {
            description: 'reconcileSlots can write a negative counter when activeCount > maxOccupancy',
            currentCode: `await redis.set(
  slotKey(destinationId),
  maxOccupancy - activeCount,
  "EX",
  86400,
);`,
            fix: `Change to Math.max(0, maxOccupancy - activeCount) to clamp at zero:
await redis.set(
  slotKey(destinationId),
  Math.max(0, maxOccupancy - activeCount),
  "EX",
  86400,
);`,
          },
        },
        testUpdates: [
          'In releaseSlot tests: add a test asserting that redis.call("EXPIRE", ...) is invoked with 86400 when val <= max (the normal INCR path). The existing cap test should still pass.',
          'In promoteFromQueue tests: add a test for the race scenario — mock updateMany to return { count: 0 } on the first call and { count: 1 } on the second, verify promoteFromQueue re-attempts promotion once and succeeds.',
          'In reconcileSlots tests: add a test where activeCount > maxOccupancy (e.g. activeCount=5, maxOccupancy=3) and assert the SET value is 0, not -2.',
        ],
      },
      instructions: [
        '1. Read apps/passes-api/src/lib/slots.ts in full.',
        '2. Apply fix #2: add redis.call("EXPIRE", key, 86400) in LUA_RELEASE_SLOT before the final return statement.',
        '3. Apply fix #4: add an optional third parameter _isRetry=false to promoteFromQueue; after releaseSlot on the race-loss path, call promoteFromQueue(destinationId, maxOccupancy, true) if !_isRetry.',
        '4. Apply fix #7: wrap maxOccupancy - activeCount in Math.max(0, ...) in reconcileSlots.',
        '5. Read apps/passes-api/tests/lib/slots.test.ts in full.',
        '6. Add the three new test cases described in testUpdates. Do not modify existing passing tests.',
        '7. Return a summary of all changes made.',
      ],
      outputFormat: 'JSON with success (boolean), filesChanged (string[]), changesSummary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['success', 'filesChanged'],
      properties: {
        success: { type: 'boolean' },
        filesChanged: { type: 'array', items: { type: 'string' } },
        changesSummary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 1b: queue.ts fixes (#3, #9) ──────────────────────────────────────

const fixQueueTask = defineTask('fix-queue', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix queue.ts: pass-day calendar lookup (#3), period over-fetch (#9)',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer fixing a BullMQ expiry worker',
      task: 'Apply two targeted fixes to apps/passes-api/src/lib/queue.ts and update the corresponding unit tests.',
      context: {
        projectRoot: args.projectRoot,
        filesToModify: [
          'apps/passes-api/src/lib/queue.ts',
          'apps/passes-api/tests/lib/queue.test.ts',
        ],
        fixes: {
          issue3_calendar_date: {
            description: 'checkIsLastPeriod uses new Date() (today) instead of the date the pass was scheduled for',
            problem: `The function currently calls:
  const todayInTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
This uses the current clock time. If a delayed BullMQ job fires on a different calendar day than the pass was created (e.g., reconcile re-queued a stale pass, or the worker was down overnight), it looks up the wrong school calendar and returns the wrong "is last period" answer.`,
            fix: `Pass a 'referenceDate: Date' parameter to checkIsLastPeriod and use it instead of new Date().

Change the signature to:
  async function checkIsLastPeriod(
    pass: { periodId: number | null; schoolId: number },
    referenceDate: Date,
  ): Promise<boolean>

Replace:
  const todayInTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
With:
  const todayInTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(referenceDate);

The call site in processPassExpiry already has access to the period end time; derive the reference date from the job's trigger time.  Since processPassExpiry is called by BullMQ at (approximately) the period end time, use 'new Date()' AT THE TOP of processPassExpiry — captured once before any await — and pass it down to checkIsLastPeriod.

In processPassExpiry, add at the top (before any await):
  const jobFiredAt = new Date();

Then call:
  const isLastPeriod = await checkIsLastPeriod(pass, jobFiredAt);`,
          },
          issue9_period_overfetch: {
            description: 'processPassExpiry uses include: { period: true } which fetches all period columns; only endTime and scheduleTypeId are needed',
            currentCode: `include: { period: true, destination: { select: { maxOccupancy: true } } }`,
            fix: `Change to:
include: {
  period: { select: { endTime: true, scheduleTypeId: true } },
  destination: { select: { maxOccupancy: true } },
}

Also update the type annotation on checkIsLastPeriod's pass parameter to include
  period: { endTime: string; scheduleTypeId: number | null } | null
instead of the full Prisma Period type, since we now only select those two fields.

Verify no other fields of period are accessed in processPassExpiry or checkIsLastPeriod (only endTime and scheduleTypeId are used).`,
          },
        },
        testUpdates: [
          'For issue #3: update queue.test.ts tests that call processPassExpiry with ACTIVE status to verify that checkIsLastPeriod is evaluated based on the captured time at the start of processPassExpiry, not a fresh new Date(). You can verify this indirectly by confirming that the test mocks for period/calendar/later-periods are correctly invoked — no change needed there, just ensure the existing ACTIVE tests still pass with the new signature.',
          'Add one new test: "uses the job-fired-at time, not current time, for calendar lookup" — mock processPassExpiry on an ACTIVE pass where the periodId is set, verify mockCalendarFindFirst was called with a date matching the approximate test start time (not a wildly different date). Use expect.objectContaining with a reasonable date range or simply verify it was called once.',
        ],
      },
      instructions: [
        '1. Read apps/passes-api/src/lib/queue.ts in full.',
        '2. Capture jobFiredAt = new Date() at the very top of processPassExpiry (before any await).',
        '3. Add referenceDate: Date parameter to checkIsLastPeriod; replace the internal new Date() with referenceDate.',
        '4. Update the call site inside processPassExpiry to pass jobFiredAt.',
        '5. Narrow the period include to { select: { endTime: true, scheduleTypeId: true } }.',
        '6. Update the pass parameter type in checkIsLastPeriod to reflect only the selected fields.',
        '7. Read apps/passes-api/tests/lib/queue.test.ts and verify existing tests still make sense with the new signature; update mock data if the period shape changed.',
        '8. Add the new calendar-lookup-time test as described.',
        '9. Return a summary of all changes made.',
      ],
      outputFormat: 'JSON with success (boolean), filesChanged (string[]), changesSummary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['success', 'filesChanged'],
      properties: {
        success: { type: 'boolean' },
        filesChanged: { type: 'array', items: { type: 'string' } },
        changesSummary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 1c: internal.ts + index.ts (#5, #6) ──────────────────────────────

const fixServerTask = defineTask('fix-server', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix internal.ts: timingSafeEqual (#5) and index.ts: SIGTERM shutdown (#6)',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer hardening a Cloud Run Express service',
      task: 'Apply two targeted fixes: use crypto.timingSafeEqual for secret comparison in internal.ts, and add graceful SIGTERM shutdown for the BullMQ worker in index.ts.',
      context: {
        projectRoot: args.projectRoot,
        filesToModify: [
          'apps/passes-api/src/routes/internal.ts',
          'apps/passes-api/src/index.ts',
        ],
        fixes: {
          issue5_timing_safe: {
            description: 'INTERNAL_SECRET compared with !== (timing oracle risk)',
            currentCode: `const auth = req.headers["authorization"];
if (!auth || auth !== \`Bearer \${env.INTERNAL_SECRET}\`) {
  res.status(401).json({ message: "Unauthorized" });
  return;
}`,
            fix: `Use Node's crypto.timingSafeEqual to compare the bytes of the provided token against the expected value:

import { timingSafeEqual } from "node:crypto";

function requireInternalSecret(req, res, next) {
  const provided = req.headers["authorization"] ?? "";
  const expected = \`Bearer \${env.INTERNAL_SECRET}\`;
  // Buffers must be equal length for timingSafeEqual; if lengths differ, comparison still takes constant time per the Buffer.from allocation, but we must avoid throwing.
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const valid =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);
  if (!valid) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
}

Note: the length check must come BEFORE timingSafeEqual (it throws if lengths differ). This is the correct pattern.`,
          },
          issue6_sigterm: {
            description: 'startExpiryWorker() return value is discarded; no SIGTERM handler closes the worker',
            currentCode: `const httpServer = http.createServer(app);
initSocket(httpServer);
httpServer.listen(PORT, () => {
  logger.info(\`passes-api listening on port \${PORT}\`);
  startExpiryWorker();
});`,
            fix: `Store the worker and close it on SIGTERM before Cloud Run kills the process:

const httpServer = http.createServer(app);
initSocket(httpServer);
httpServer.listen(PORT, () => {
  logger.info(\`passes-api listening on port \${PORT}\`);
  const expiryWorker = startExpiryWorker();

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received — closing expiry worker");
    expiryWorker.close().catch((err) =>
      logger.error(err, "Error closing expiry worker"),
    );
  });
});

Keep the existing unhandledRejection and uncaughtException handlers unchanged.`,
          },
        },
      },
      instructions: [
        '1. Read apps/passes-api/src/routes/internal.ts in full.',
        '2. Add `import { timingSafeEqual } from "node:crypto";` at the top.',
        '3. Replace the requireInternalSecret function body with the timingSafeEqual implementation as described.',
        '4. Read apps/passes-api/src/index.ts in full.',
        '5. Store the return value of startExpiryWorker() in a variable.',
        '6. Add a process.on("SIGTERM", ...) handler that closes the worker.',
        '7. Do not modify any other code in either file.',
        '8. Return a summary of all changes made.',
      ],
      outputFormat: 'JSON with success (boolean), filesChanged (string[]), changesSummary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['success', 'filesChanged'],
      properties: {
        success: { type: 'boolean' },
        filesChanged: { type: 'array', items: { type: 'string' } },
        changesSummary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 1d: deploy.yml + app.ts + socket.ts (#8, #10) ────────────────────

const fixInfraTask = defineTask('fix-infra', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix deploy.yml: distinct cache scopes (#8) and app.ts/socket.ts: corsOrigins fragility (#10)',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript/DevOps engineer making targeted configuration fixes',
      task: 'Apply two targeted fixes: distinct GHA Docker cache scopes for dev vs prod, and use env.CORS_ORIGIN !== "*" instead of corsOrigins !== "*" in app.ts and socket.ts.',
      context: {
        projectRoot: args.projectRoot,
        filesToModify: [
          '.github/workflows/deploy.yml',
          'apps/passes-api/src/app.ts',
          'apps/passes-api/src/lib/socket.ts',
        ],
        fixes: {
          issue8_gha_cache: {
            description: 'Dev and prod deploy jobs share the same GHA Docker layer cache scope "passes-api"',
            problem: 'When prod (main) pushes a cache entry, it can be restored by the next dev (develop) build and vice versa. Divergent images can pollute each other\'s cache layers.',
            fix: `In the deploy-passes-api-dev job, change:
  cache-from: type=gha,scope=passes-api
  cache-to: type=gha,mode=max,scope=passes-api
To:
  cache-from: type=gha,scope=passes-api-dev
  cache-to: type=gha,mode=max,scope=passes-api-dev

In the deploy-passes-api-prod job, change:
  cache-from: type=gha,scope=passes-api
  cache-to: type=gha,mode=max,scope=passes-api
To:
  cache-from: type=gha,scope=passes-api-prod
  cache-to: type=gha,mode=max,scope=passes-api-prod

No other lines in the file should be touched.`,
          },
          issue10_cors_fragility: {
            description: 'corsOrigins !== "*" is fragile — corsOrigins is typed string | string[], so the comparison works by coincidence today but would silently break if lib/cors.ts ever changes to return "*" inside an array',
            fix: `In both app.ts and socket.ts, change:
  credentials: corsOrigins !== "*",
To:
  credentials: env.CORS_ORIGIN !== "*",

In app.ts: env is already imported from "./env.js".
In socket.ts: env is already imported from "../env.js".

Do not change any other logic in either file.`,
          },
        },
      },
      instructions: [
        '1. Read .github/workflows/deploy.yml and locate both the deploy-passes-api-dev and deploy-passes-api-prod jobs.',
        '2. In deploy-passes-api-dev: change both cache-from and cache-to scope values from "passes-api" to "passes-api-dev".',
        '3. In deploy-passes-api-prod: change both cache-from and cache-to scope values from "passes-api" to "passes-api-prod".',
        '4. Read apps/passes-api/src/app.ts — change `credentials: corsOrigins !== "*"` to `credentials: env.CORS_ORIGIN !== "*"`.',
        '5. Read apps/passes-api/src/lib/socket.ts — change `credentials: corsOrigins !== "*"` to `credentials: env.CORS_ORIGIN !== "*"`.',
        '6. Do not touch any other lines in any of these files.',
        '7. Return a summary of all changes made.',
      ],
      outputFormat: 'JSON with success (boolean), filesChanged (string[]), changesSummary (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['success', 'filesChanged'],
      properties: {
        success: { type: 'boolean' },
        filesChanged: { type: 'array', items: { type: 'string' } },
        changesSummary: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 2: Build + unit test ──────────────────────────────────────────────
// buildAndTestTask imported from ./shared/passes-api-build-tasks.js

// ─── Phase 2 convergence: fix remaining build/test errors ────────────────────

const fixBuildErrorsTask = makeFixBuildErrorsTask({
  relevantFiles: [
    'apps/passes-api/src/lib/slots.ts',
    'apps/passes-api/tests/lib/slots.test.ts',
    'apps/passes-api/src/lib/queue.ts',
    'apps/passes-api/tests/lib/queue.test.ts',
    'apps/passes-api/src/routes/internal.ts',
    'apps/passes-api/src/index.ts',
    'apps/passes-api/src/app.ts',
    'apps/passes-api/src/lib/socket.ts',
  ],
  commonCauses: [
    'Type error from narrowed period select shape — update pass type annotation in checkIsLastPeriod',
    'promoteFromQueue signature change — callers must accept optional third param',
    'timingSafeEqual import path — use "node:crypto", not "crypto"',
    'Worker.close() is async — make sure the SIGTERM handler awaits or chains correctly',
    'Test mock for period may need { endTime, scheduleTypeId } shape now, not full Period',
  ],
});
