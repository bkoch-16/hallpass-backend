/**
 * @process fix-socket-adapter-and-infra-doc
 * @description Fix two issues identified in the passes-api code review:
 *   1. Wire @socket.io/redis-adapter so Socket.io events fan-out across Cloud Run instances.
 *      Without the adapter, each instance has an isolated namespace — emitting on instance A
 *      never reaches clients connected to instance B.
 *   2. Add INTERNAL_SECRET to the INFRA.md Required Environment Variables table for passes-api.
 *      It is required by env.ts but was omitted from the ops-facing documentation.
 *
 * Phases:
 *   1 — Apply changes in parallel (INFRA.md doc fix + socket adapter wiring + test update)
 *   2 — Install new dependency (pnpm install)
 *   3 — Build + test verification with convergence loop (max 3 attempts)
 *   4 — Breakpoint: human review before any commit
 *
 * Profile: intermediate TS/Node.js user, semi-autonomous, moderate breakpoint tolerance.
 * No deploy or migration steps — no additional alwaysBreakOn triggers.
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';
import { buildAndTestTask, makeFixBuildErrorsTask } from './shared/passes-api-build-tasks.js';

export async function process(inputs, ctx) {
  const projectRoot = '/Users/bkoch/development/hallpass-backend';
  const MAX_FIX_ITERATIONS = 3;

  // ============================================================================
  // PHASE 1 — Apply code changes in parallel
  // ============================================================================

  ctx.log('info', 'Phase 1: Applying fixes in parallel');

  await ctx.parallel.all([
    () => ctx.task(fixInfraDocTask, { projectRoot }),
    () => ctx.task(wireSocketAdapterTask, { projectRoot }),
  ]);

  // ============================================================================
  // PHASE 2 — Install new dependency
  // ============================================================================

  ctx.log('info', 'Phase 2: Installing @socket.io/redis-adapter');

  await ctx.task(installDepsTask, { projectRoot });

  // ============================================================================
  // PHASE 3 — Build + test verification with convergence
  // ============================================================================

  ctx.log('info', 'Phase 3: Build and test verification');

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
  // PHASE 4 — Breakpoint: human review before commit
  // ============================================================================

  const summary = verified
    ? `Both fixes applied and verified (${iteration === 1 ? 'first try' : `after ${iteration - 1} fix(es)`}).`
    : `Verification still failing after ${MAX_FIX_ITERATIONS} attempts. Last output tail:\n\n${lastOutput.slice(-400)}`;

  await ctx.breakpoint({
    question: verified
      ? [
          `${summary}`,
          '',
          'Changes made:',
          '  • docs/INFRA.md — added INTERNAL_SECRET row to the passes-api env var table',
          '  • apps/passes-api/package.json — added @socket.io/redis-adapter dependency',
          '  • apps/passes-api/src/lib/socket.ts — wired Redis adapter (pubClient + subClient)',
          '  • apps/passes-api/tests/lib/socket.test.ts — mocked @socket.io/redis-adapter and ioredis',
          '',
          'Build and unit tests pass. Approve to mark complete, or reject to keep reviewing.',
        ].join('\n')
      : `${summary}\n\nHow would you like to proceed?`,
    title: verified ? 'Review Changes Before Commit' : 'Verification Failed — Review Required',
    context: { runId: ctx.runId },
  });

  return { success: verified, iterations: iteration };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

const fixInfraDocTask = defineTask('fix-infra-doc', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Add INTERNAL_SECRET to INFRA.md passes-api env var table',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer fixing documentation',
      task: 'Add the missing INTERNAL_SECRET row to the passes-api Required Environment Variables table in docs/INFRA.md.',
      context: {
        projectRoot: args.projectRoot,
        targetFile: 'docs/INFRA.md',
        issue: 'INTERNAL_SECRET is required by apps/passes-api/src/env.ts but is not listed in the passes-api Required Environment Variables table in docs/INFRA.md.',
        tableLocation: 'Under the ## passes-api > ### Required Environment Variables heading.',
        rowToAdd: '| `INTERNAL_SECRET`    | Shared secret for the /internal/* routes (Cloud Scheduler) |',
        existingRows: [
          '| `DATABASE_URL`       | Neon Postgres connection string                          |',
          '| `BETTER_AUTH_URL`    | Base URL of the auth service                             |',
          '| `BETTER_AUTH_SECRET` | Shared secret for better-auth session verification       |',
          '| `REDIS_URL`          | Upstash Redis URL (used by Socket.io adapter and BullMQ) |',
          '| `CORS_ORIGIN`        | Allowed CORS origin(s)                                   |',
          '| `PORT`               | HTTP listen port (defaults to `3003`)                    |',
        ],
        insertAfter: '`CORS_ORIGIN` row — keep PORT as the last row',
      },
      instructions: [
        'Read docs/INFRA.md in full to locate the passes-api Required Environment Variables table.',
        'Insert the INTERNAL_SECRET row between the CORS_ORIGIN and PORT rows.',
        'Do not change any other content in the file.',
        'Verify the table alignment looks correct (pipe characters lined up).',
        'Return a summary of what was changed.',
      ],
      outputFormat: 'JSON with success (boolean), changeDescription (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['success'],
      properties: {
        success: { type: 'boolean' },
        changeDescription: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ----------------------------------------------------------------------------

const wireSocketAdapterTask = defineTask('wire-socket-adapter', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Wire @socket.io/redis-adapter in socket.ts and update socket test',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer fixing a multi-instance Socket.io deployment issue',
      task: [
        'Add @socket.io/redis-adapter to apps/passes-api/package.json and wire it in socket.ts',
        'so that Socket.io events fan-out across all Cloud Run instances via Redis pub/sub.',
        'Also update the socket unit test to mock the new dependency.',
      ].join(' '),
      context: {
        projectRoot: args.projectRoot,
        issue: [
          'apps/passes-api/src/lib/socket.ts currently creates a Socket.io Server without a Redis adapter.',
          'In multi-instance deployments (Cloud Run auto-scaling), events emitted on instance A',
          'never reach clients connected to instance B.',
          '@socket.io/redis-adapter solves this by routing events through Redis pub/sub.',
        ].join(' '),
        filesToModify: [
          'apps/passes-api/package.json',
          'apps/passes-api/src/lib/socket.ts',
          'apps/passes-api/tests/lib/socket.test.ts',
        ],
        currentSocketTs: [
          'import { Server, type Socket } from "socket.io";',
          'import type { Server as HttpServer } from "http";',
          'import { auth } from "../auth.js";',
          'import { corsOrigins } from "./cors.js";',
          '',
          'let io: Server;',
          '',
          'export function initSocket(httpServer: HttpServer): Server {',
          '  io = new Server(httpServer, {',
          '    cors: { origin: corsOrigins, credentials: corsOrigins !== "*" },',
          '  });',
          '  // ... auth middleware and connection handler follow',
          '}',
        ].join('\n'),
        adapterIntegrationPattern: [
          '// In initSocket(), after creating the Server and before returning:',
          'import { createAdapter } from "@socket.io/redis-adapter";',
          'import Redis from "ioredis";',
          '',
          '// Create dedicated pub/sub clients (separate from slots/queue connections)',
          'const pubClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });',
          'const subClient = pubClient.duplicate();',
          '',
          '// Attach adapter — must happen before any emit or join',
          'io.adapter(createAdapter(pubClient, subClient));',
        ].join('\n'),
        testFileLocation: 'apps/passes-api/tests/lib/socket.test.ts',
        currentTestMocks: [
          'The test already mocks: ../../src/auth.js, ../../src/env.js',
          'After adding the adapter, the test must also mock:',
          '  - ioredis: class MockRedis { constructor() {} duplicate() { return this; } on() {} }',
          '  - @socket.io/redis-adapter: { createAdapter: vi.fn().mockReturnValue(vi.fn()) }',
          'The existing three tests (does not throw, initSocket returns Server, emitPassEvent emits to rooms) must continue to pass.',
          'Add the ioredis and adapter mocks BEFORE any import of socket.ts or lib modules.',
        ].join('\n'),
        envImport: 'env is imported from "../env.js" which is already available in socket.ts context',
        redisNote: [
          'The pub/sub clients are separate from the redis singleton in src/lib/redis.ts',
          '(which uses lazyConnect + maxRetriesPerRequest:3 for slots).',
          'BullMQ connections and slot connections are unaffected.',
        ].join(' '),
      },
      instructions: [
        '1. Read apps/passes-api/package.json — add "@socket.io/redis-adapter": "^0.2.1" to dependencies (check npm for latest 0.2.x compatible with socket.io@4.x).',
        '   Note: the correct package for socket.io v4 with ioredis is @socket.io/redis-adapter. Check that the version is compatible with socket.io@4.8.x.',
        '2. Read apps/passes-api/src/lib/socket.ts in full.',
        '3. Update socket.ts:',
        '   - Add imports: createAdapter from @socket.io/redis-adapter; Redis from ioredis; env from ../env.js',
        '   - Inside initSocket(), after creating the io Server and before configuring auth middleware:',
        '     create pubClient and subClient, attach the adapter, add error listeners on both clients.',
        '4. Read apps/passes-api/tests/lib/socket.test.ts in full.',
        '5. Update the socket test:',
        '   - Add vi.mock("ioredis", ...) with a MockRedis that has duplicate(), on(), and a no-op constructor.',
        '   - Add vi.mock("@socket.io/redis-adapter", ...) returning { createAdapter: vi.fn().mockReturnValue(vi.fn()) }.',
        '   - Place both mocks before the existing vi.mock calls (before any socket.ts import).',
        '   - Do not change the three existing test cases — they must still pass.',
        '6. Return a summary of all files changed.',
      ],
      outputFormat: 'JSON with success (boolean), filesChanged (string[]), notes (string)',
    },
    outputSchema: {
      type: 'object',
      required: ['success', 'filesChanged'],
      properties: {
        success: { type: 'boolean' },
        filesChanged: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ----------------------------------------------------------------------------

const installDepsTask = defineTask('install-deps', (args) => ({
  kind: 'shell',
  title: 'pnpm install (pull @socket.io/redis-adapter)',
  command: 'pnpm install 2>&1; echo "EXIT_CODE:$?"',
  cwd: args.projectRoot,
  timeout: 60000,
  outputSchema: {
    type: 'object',
    required: ['passed', 'output'],
    properties: {
      passed: { type: 'boolean' },
      output: { type: 'string' },
    },
  },
  transform: (stdout) => {
    const passed = !stdout.includes('EXIT_CODE:1') && !stdout.includes('ERR_');
    return { passed, output: stdout };
  },
}));

// buildAndTestTask and makeFixBuildErrorsTask imported from ./shared/passes-api-build-tasks.js

const fixBuildErrorsTask = makeFixBuildErrorsTask({
  relevantFiles: [
    'apps/passes-api/src/lib/socket.ts',
    'apps/passes-api/tests/lib/socket.test.ts',
    'apps/passes-api/package.json',
  ],
  commonCauses: [
    'Missing type declarations for @socket.io/redis-adapter (may need @types or the package bundles its own)',
    'Incorrect mock structure for ioredis or redis-adapter in socket.test.ts',
    'Import path issues (use .js extension in imports for TypeScript ESM)',
    'The duplicate() method on MockRedis needs to return itself or another mock instance',
    'createAdapter mock needs to return a function (the adapter factory returns a function, not the adapter directly)',
  ],
});
