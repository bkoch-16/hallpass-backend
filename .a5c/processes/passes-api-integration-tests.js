/**
 * @process passes-api-integration-tests
 * @description Write integration tests for all 7 passes-api endpoints, following
 * the schools-api/user-api patterns. Uses real Prisma/PostgreSQL and mocks
 * auth, Redis (slots), Socket.io, and BullMQ. Converges until all tests pass.
 *
 * Phases:
 *   1 — Write: Create tests/setup/integration-global.ts + tests/integration/passes.test.ts
 *   2 — Verify: Run tests and fix failures (convergence, max 3 attempts)
 *   3 — Review: Human breakpoint before done
 *
 * @skill growing-outside-in-systems specializations/backend-development/skills/growing-outside-in-systems/SKILL.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs, ctx) {
  const projectRoot = '/Users/bkoch/development/hallpass-backend';
  const MAX_FIX_ITERATIONS = 3;

  // ============================================================================
  // PHASE 1: WRITE INTEGRATION TEST FILES
  // ============================================================================

  ctx.log('info', 'Phase 1: Writing integration test setup and test file');

  await ctx.task(writeIntegrationTestsTask, { projectRoot });

  // ============================================================================
  // PHASE 2: VERIFY — run tests with convergence loop
  // ============================================================================

  ctx.log('info', 'Phase 2: Running integration tests');

  let fixIteration = 0;
  let testsPassed = false;
  let lastOutput = '';

  while (fixIteration < MAX_FIX_ITERATIONS && !testsPassed) {
    const result = await ctx.task(runTestsTask, { projectRoot, attempt: fixIteration + 1 });
    lastOutput = result.output || '';
    testsPassed = result.passed === true;

    if (!testsPassed && fixIteration + 1 < MAX_FIX_ITERATIONS) {
      ctx.log('warn', `Attempt ${fixIteration + 1} failed — fixing tests`);
      await ctx.task(fixTestsTask, { projectRoot, testOutput: lastOutput, iteration: fixIteration + 1 });
    }

    fixIteration++;
  }

  // ============================================================================
  // PHASE 3: REVIEW BREAKPOINT
  // ============================================================================

  const summary = testsPassed
    ? `All integration tests pass (${fixIteration === 1 ? 'first try' : `after ${fixIteration - 1} fix(es)`}).\n\n` +
      'Files written:\n' +
      '  • apps/passes-api/tests/setup/integration-global.ts\n' +
      '  • apps/passes-api/tests/integration/passes.test.ts\n\n' +
      'Run manually:\n' +
      '  docker-compose up -d postgres\n' +
      '  pnpm --filter @hallpass/passes-api test:integration'
    : `Tests still failing after ${MAX_FIX_ITERATIONS} attempts.\n\nLast output (tail):\n${lastOutput.slice(-600)}`;

  await ctx.breakpoint({
    question: testsPassed
      ? `${summary}\n\nApprove to mark complete?`
      : `${summary}\n\nHow would you like to proceed?`,
    title: testsPassed ? 'Integration Tests: Passing' : 'Integration Tests: Still Failing',
    context: { runId: ctx.runId },
  });

  return { success: testsPassed, fixIterations: fixIteration - 1 };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

const writeIntegrationTestsTask = defineTask('write-integration-tests', (args) => ({
  kind: 'agent',
  title: 'Write integration test setup + test file',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Create two new files for the passes-api integration test suite.',

      context: {
        projectRoot: args.projectRoot,

        referenceFiles: [
          'apps/schools-api/tests/setup/integration-global.ts',
          'apps/schools-api/tests/integration/school.test.ts',
          'apps/schools-api/tests/integration/policy.test.ts',
          'apps/passes-api/src/routes/passes.ts',
          'apps/passes-api/src/app.ts',
          'packages/db/prisma/schema.prisma',
          'apps/passes-api/vitest.integration.config.ts',
        ],

        endpointSummary: [
          'POST   /passes            — student creates a pass (requires active period, destination, policy, slot)',
          'GET    /passes            — list passes (student sees own; teacher/admin see all in school)',
          'GET    /passes/:id        — get single pass (student scoped to own; teacher/admin any in school)',
          'POST   /passes/:id/approve — TEACHER|ADMIN only; transitions PENDING→ACTIVE or PENDING→WAITING',
          'POST   /passes/:id/deny   — TEACHER|ADMIN only; transitions PENDING→DENIED',
          'POST   /passes/:id/return — student (own) or TEACHER|ADMIN; transitions ACTIVE→COMPLETED',
          'POST   /passes/:id/cancel — all authenticated; student own, teacher/admin any in school; PENDING|WAITING|ACTIVE→CANCELLED',
        ],

        modelsNeededForSeeding: [
          'District (optional parent of School)',
          'School (name, timezone)',
          'User (email, name, role, schoolId)',
          'Destination (name, schoolId, maxOccupancy)',
          'Period (name, schoolId, startTime HH:MM, endTime HH:MM)',
          'SchoolCalendar (schoolId, date YYYY-MM-DD, periodIds JSON)',
          'PassPolicy (schoolId, maxActivePasses, interval, maxPerInterval)',
          'Pass (schoolId, studentId, destinationId, periodId, status, note, approverId, denierId, etc.)',
        ],

        mocksRequired: [
          '@hallpass/auth — mock createAuth, toNodeHandler, fromNodeHeaders (same as schools-api)',
          '../../src/lib/slots.js — mock claimSlot (returns true), releaseSlot, promoteFromQueue, reconcileSlots',
          '../../src/lib/socket.js — mock emitPassEvent, initSocket',
          '../../src/lib/queue.js — mock schedulePassExpiry',
        ],

        testCoverageRequired: {
          'POST /passes': [
            '201 student creates pass — seeds school with active period+policy+destination, verifies DB record',
            '401 unauthenticated',
            '422 student has no schoolId',
            '422 no active period for current time',
            '422 destination not found or not in school',
          ],
          'GET /passes': [
            '200 student sees only own passes',
            '200 teacher sees all passes in school',
            '401 unauthenticated',
          ],
          'GET /passes/:id': [
            '200 student fetches own pass',
            '404 student cannot fetch another student\'s pass',
            '200 teacher fetches any pass in school',
            '404 pass not found',
          ],
          'POST /passes/:id/approve': [
            '200 teacher approves PENDING pass → ACTIVE (when claimSlot returns true)',
            '200 teacher approves PENDING pass → WAITING (when claimSlot returns false)',
            '400 pass is not PENDING',
            '403 student cannot approve',
            '404 pass not found',
          ],
          'POST /passes/:id/deny': [
            '200 teacher denies PENDING pass → DENIED',
            '400 pass is not PENDING',
            '403 student cannot deny',
          ],
          'POST /passes/:id/return': [
            '200 student returns own ACTIVE pass → COMPLETED',
            '200 teacher returns ACTIVE pass → COMPLETED',
            '400 pass is not ACTIVE',
            '404 student cannot return another student\'s pass',
          ],
          'POST /passes/:id/cancel': [
            '200 student cancels own PENDING pass → CANCELLED',
            '200 teacher cancels any PENDING pass in school → CANCELLED',
            '400 pass is not PENDING/WAITING/ACTIVE',
          ],
        },

        importantNotes: [
          'Use vi.hoisted for mockGetSession, same pattern as schools-api',
          'Auth mock must be declared BEFORE importing app',
          'beforeEach: vi.clearAllMocks() then deleteMany in FK-safe order: Pass, PassPolicy, Destination, Period, SchoolCalendar, User, School, District',
          'afterAll: same deleteMany order then prisma.$disconnect()',
          'Seed helpers: seedDistrict, seedSchool, seedUser, seedDestination, seedPeriod, seedSchoolCalendar, seedPassPolicy, seedPass',
          'For POST /passes to succeed the school must have an active period for "now" and a destination',
          'For period matching: the route resolves current time in school timezone — seed a period with startTime "00:00" and endTime "23:59" and a SchoolCalendar entry for today\'s date to guarantee it is always active',
          'For today\'s date in SchoolCalendar: use new Date().toISOString().slice(0, 10) at test time',
          'claimSlot is already mocked — default mock returns true (ACTIVE). In specific tests use mockReturnValueOnce(false) to test WAITING path',
          'Do NOT use actual Redis or Socket.io connections — they are mocked at the vi.mock level',
        ],
      },

      instructions: [
        'Read the reference files listed in context.referenceFiles to understand exact patterns',
        'Create apps/passes-api/tests/setup/integration-global.ts — runs prisma migrate deploy, identical to schools-api setup',
        'Create apps/passes-api/tests/integration/passes.test.ts covering all endpoints and scenarios in context.testCoverageRequired',
        'Follow ALL important notes in context.importantNotes exactly',
        'Use crypto.randomUUID() in seed email addresses to avoid collisions',
        'Keep test file self-contained — no shared fixtures file',
        'Return a summary listing which files were created and how many tests were written',
      ],

      outputFormat: 'JSON with fields: filesCreated (string[]), testCount (number), notes (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['filesCreated', 'testCount'],
      properties: {
        filesCreated: { type: 'array', items: { type: 'string' } },
        testCount: { type: 'number' },
        notes: { type: 'string' },
      },
    },
  },
}));

// ----------------------------------------------------------------------------

const runTestsTask = defineTask('run-integration-tests', (args) => ({
  kind: 'shell',
  title: `Run integration tests (attempt ${args.attempt})`,
  command: 'pnpm --filter @hallpass/passes-api test:integration 2>&1; echo "EXIT_CODE:$?"',
  cwd: args.projectRoot,
  timeout: 120000,
  outputSchema: {
    type: 'object',
    required: ['passed', 'output'],
    properties: {
      passed: { type: 'boolean' },
      output: { type: 'string' },
    },
  },
  transform: (stdout) => {
    const passed = !stdout.includes('EXIT_CODE:1') && !stdout.includes('failed') && stdout.includes('passed');
    return { passed, output: stdout };
  },
}));

// ----------------------------------------------------------------------------

const fixTestsTask = defineTask('fix-integration-tests', (args) => ({
  kind: 'agent',
  title: `Fix failing integration tests (iteration ${args.iteration})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Fix the failing integration tests in apps/passes-api/tests/integration/passes.test.ts',
      context: {
        testOutput: args.testOutput,
        testFile: 'apps/passes-api/tests/integration/passes.test.ts',
        setupFile: 'apps/passes-api/tests/setup/integration-global.ts',
        routesFile: 'apps/passes-api/src/routes/passes.ts',
        schemaFile: 'packages/db/prisma/schema.prisma',
      },
      instructions: [
        'Read the test output carefully to understand why tests are failing',
        'Read the relevant source files to understand the actual behavior',
        'Fix ONLY the specific failures shown — do not rewrite passing tests',
        'Common issues: FK constraint order in deleteMany, missing seed fields, wrong mock return values, wrong HTTP status expectations',
        'After fixing, briefly describe what was wrong and what you changed',
      ],
      outputFormat: 'JSON with fields: fixedIssues (string[]), filesModified (string[])',
    },
    outputSchema: {
      type: 'object',
      required: ['fixedIssues'],
      properties: {
        fixedIssues: { type: 'array', items: { type: 'string' } },
        filesModified: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}));
