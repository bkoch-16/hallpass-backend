/**
 * @process passes-api-implementation
 * @description Build passes-api from scratch in the hallpass-backend monorepo.
 * Mirrors apps/schools-api structure: Express 5, Zod, Vitest, Prisma, Docker, Cloud Run.
 * Adds Redis (Upstash/ioredis) slot counters, Socket.io real-time events, BullMQ expiry
 * queue, and GitHub Actions deploy jobs for dev + prod.
 *
 * Phases:
 *   1 — Prisma schema (Pass model + PassStatus enum + migration + partial unique index)
 *   2 — App scaffold (package.json, tsconfig, env, app, index, middleware, Dockerfile)
 *   3 — REST endpoints with TDD (POST/GET + role-guarded action routes)
 *   4 — Redis slot management (Upstash/ioredis, DECR-based, self-healing, queue promotion)
 *   5 — Socket.io real-time layer (rooms, auth, state-transition events)
 *   6 — BullMQ expiry queue (delayed jobs, period-end logic, reconciliation endpoint)
 *   7 — CI/CD deploy jobs + documentation updates
 *
 * @skill growing-outside-in-systems specializations/backend-development/skills/growing-outside-in-systems/SKILL.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs, ctx) {
  const projectRoot = '/Users/bkoch/development/hallpass-backend';

  // ============================================================================
  // PHASE 1: PRISMA SCHEMA — Pass model + migration
  // ============================================================================

  ctx.log('info', 'Phase 1: Adding Pass model and PassStatus enum to Prisma schema');

  await ctx.task(phase1SchemaTask, { projectRoot });

  await ctx.breakpoint({
    question:
      'Phase 1 complete: Pass model and PassStatus enum added to schema.prisma, migration created, ' +
      'and partial unique index SQL appended.\n\n' +
      'Review:\n' +
      '  • packages/db/prisma/schema.prisma — Pass model + PassStatus enum\n' +
      '  • packages/db/prisma/migrations/<latest>/migration.sql — verify partial unique index is present\n\n' +
      'Approve to scaffold the passes-api application?',
    title: 'Review: Schema + Migration',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 2: APP SCAFFOLD
  // ============================================================================

  ctx.log('info', 'Phase 2: Scaffolding apps/passes-api/ directory');

  await ctx.task(phase2ScaffoldTask, { projectRoot });

  await ctx.breakpoint({
    question:
      'Phase 2 complete: apps/passes-api/ scaffolded.\n\n' +
      'Review:\n' +
      '  • apps/passes-api/package.json — deps include socket.io, ioredis, bullmq\n' +
      '  • apps/passes-api/src/env.ts — has REDIS_URL in Zod schema\n' +
      '  • apps/passes-api/Dockerfile — exposes port 3003\n' +
      '  • apps/passes-api/docker-entrypoint.sh — runs prisma migrate deploy then node dist/index.js\n' +
      '  • pnpm --filter @hallpass/passes-api build — should exit 0\n\n' +
      'Approve to implement REST endpoints?',
    title: 'Review: App Scaffold',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 3: REST ENDPOINTS (TDD)
  // ============================================================================

  ctx.log('info', 'Phase 3: Implementing REST endpoints with TDD');

  await ctx.task(phase3EndpointsTask, { projectRoot });

  await ctx.breakpoint({
    question:
      'Phase 3 complete: REST endpoints implemented with tests.\n\n' +
      'Review:\n' +
      '  • apps/passes-api/src/routes/passes.ts — all 7 endpoints\n' +
      '  • apps/passes-api/src/schemas/passes.ts — Zod request schemas\n' +
      '  • apps/passes-api/tests/routes/passes.test.ts — unit tests\n' +
      '  • pnpm --filter @hallpass/passes-api test run — should show all passing\n\n' +
      'Approve to add Redis slot counters?',
    title: 'Review: REST Endpoints',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 4: REDIS SLOT COUNTERS (Upstash)
  // ============================================================================

  ctx.log('info', 'Phase 4: Implementing Redis slot counters');

  await ctx.task(phase4RedisTask, { projectRoot });

  await ctx.breakpoint({
    question:
      'Phase 4 complete: Redis slot counters implemented.\n\n' +
      'Review:\n' +
      '  • apps/passes-api/src/lib/redis.ts — ioredis client\n' +
      '  • apps/passes-api/src/lib/slots.ts — initSlots, claimSlot, releaseSlot, reconcile, promote\n' +
      '  • slot logic integrated in approve/return/cancel/deny route handlers\n' +
      '  • tests verify slot exhaustion → 409, slot release → WAITING promoted\n\n' +
      'Approve to add Socket.io real-time layer?',
    title: 'Review: Redis Slot Counters',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 5: SOCKET.IO REAL-TIME
  // ============================================================================

  ctx.log('info', 'Phase 5: Attaching Socket.io for real-time events');

  await ctx.task(phase5SocketTask, { projectRoot });

  await ctx.breakpoint({
    question:
      'Phase 5 complete: Socket.io real-time layer attached.\n\n' +
      'Review:\n' +
      '  • apps/passes-api/src/lib/socket.ts — Server, auth-on-connect, emitPassEvent\n' +
      '  • src/index.ts updated to http.createServer(app) with socket attached\n' +
      '  • all route handlers emit pass:created, pass:approved, pass:denied, etc.\n' +
      '  • integration test verifies event fires after POST /passes\n\n' +
      'Approve to add BullMQ expiry queue?',
    title: 'Review: Socket.io',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 6: BULLMQ EXPIRY QUEUE
  // ============================================================================

  ctx.log('info', 'Phase 6: Implementing BullMQ pass expiry queue');

  await ctx.task(phase6BullmqTask, { projectRoot });

  await ctx.breakpoint({
    question:
      'Phase 6 complete: BullMQ expiry queue implemented.\n\n' +
      'Review:\n' +
      '  • apps/passes-api/src/lib/queue.ts — Queue + Worker for pass-expiry\n' +
      '  • schedulePassExpiry called in POST /passes after resolving periodId\n' +
      '  • worker transitions PENDING/WAITING → EXPIRED, ACTIVE → COMPLETED (last period)\n' +
      '  • POST /internal/reconcile-expiry endpoint for Cloud Scheduler\n' +
      '  • BullMQ unit tests pass\n\n' +
      'Approve to add deploy jobs and update documentation?',
    title: 'Review: BullMQ Expiry',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 7: DEPLOY + DOCS
  // ============================================================================

  ctx.log('info', 'Phase 7: Adding CI/CD deploy jobs and updating documentation');

  await ctx.task(phase7DeployTask, { projectRoot });

  return { success: true };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

const phase1SchemaTask = defineTask('phase1-schema', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Add Pass model and PassStatus enum to Prisma schema',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Add the PassStatus enum and Pass model to packages/db/prisma/schema.prisma, then create a Prisma migration and append the partial unique index SQL.',
      context: {
        projectRoot: args.projectRoot,
        schemaFile: 'packages/db/prisma/schema.prisma',
        migrationsDir: 'packages/db/prisma/migrations/',
        passStatusEnum: 'PENDING, WAITING, ACTIVE, COMPLETED, CANCELLED, DENIED, EXPIRED',
        passModel: {
          fields: [
            'id Int @id @default(autoincrement())',
            'schoolId Int',
            'studentId Int',
            'destinationId Int',
            'periodId Int?',
            'approverId Int?',
            'denierId Int?',
            'cancellerId Int?',
            'status PassStatus @default(PENDING)',
            'note String?',
            'approverNote String?',
            'requestedAt DateTime @default(now())',
            'approvedAt DateTime?',
            'returnedAt DateTime?',
            'cancelledAt DateTime?',
            'deniedAt DateTime?',
            'expiredAt DateTime?'
          ],
          relations: [
            'school School @relation(fields: [schoolId], references: [id])',
            'student User @relation("StudentPasses", fields: [studentId], references: [id])',
            'destination Destination @relation(fields: [destinationId], references: [id])',
            'period Period? @relation(fields: [periodId], references: [id])',
            'approver User? @relation("ApproverPasses", fields: [approverId], references: [id])',
            'denier User? @relation("DenierPasses", fields: [denierId], references: [id])',
            'canceller User? @relation("CancellerPasses", fields: [cancellerId], references: [id])'
          ],
          indexes: ['@@index([schoolId])', '@@index([studentId])', '@@index([status])']
        },
        partialUniqueIndexSQL:
          'CREATE UNIQUE INDEX one_active_pass_per_student ON "Pass" ("studentId") WHERE status IN (\'PENDING\', \'WAITING\', \'ACTIVE\');',
        migrationCommand:
          'cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/db exec prisma migrate dev --name add-pass-model --create-only'
      },
      instructions: [
        'Read the full packages/db/prisma/schema.prisma to understand existing models and relations',
        'Add the PassStatus enum BEFORE the Pass model definition',
        'Add the Pass model with all fields, relations, and indexes listed in the context',
        'For User back-relations: User model needs passes User[] fields — check if User already has any pass relations and add them if missing (e.g., studentPasses Pass[] @relation("StudentPasses"), approvedPasses Pass[] @relation("ApproverPasses"), deniedPasses Pass[] @relation("DenierPasses"), cancelledPasses Pass[] @relation("CancellerPasses"))',
        'For School back-relation: add passes Pass[] to School model',
        'For Destination back-relation: add passes Pass[] to Destination model',
        'For Period back-relation: add passes Pass[] to Period model',
        'Run the migration command (--create-only, do NOT run migrate deploy)',
        'After the migration SQL file is generated, append the partial unique index SQL to the end of the migration file (before any trailing comments)',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/db exec prisma generate to verify the schema compiles',
        'Report the migration file path and confirm prisma generate exits 0'
      ],
      outputFormat: 'Summary of schema changes, migration file path, and prisma generate result'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const phase2ScaffoldTask = defineTask('phase2-scaffold', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Scaffold apps/passes-api/ mirroring schools-api structure',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Create apps/passes-api/ from scratch by mirroring apps/schools-api/ structure exactly, with passes-api-specific adjustments (port 3003, REDIS_URL env var, extra deps).',
      context: {
        projectRoot: args.projectRoot,
        templateDir: 'apps/schools-api/',
        targetDir: 'apps/passes-api/',
        port: 3003,
        packageName: '@hallpass/passes-api',
        additionalDeps: ['socket.io', 'ioredis', 'bullmq'],
        additionalEnvVars: ['REDIS_URL'],
        filesToCreate: [
          'apps/passes-api/package.json',
          'apps/passes-api/tsconfig.json',
          'apps/passes-api/vitest.config.ts',
          'apps/passes-api/vitest.integration.config.ts',
          'apps/passes-api/src/index.ts',
          'apps/passes-api/src/app.ts',
          'apps/passes-api/src/env.ts',
          'apps/passes-api/src/auth.ts',
          'apps/passes-api/src/middleware/auth.ts',
          'apps/passes-api/src/middleware/roleGuard.ts',
          'apps/passes-api/src/middleware/validate.ts',
          'apps/passes-api/Dockerfile',
          'apps/passes-api/docker-entrypoint.sh'
        ]
      },
      instructions: [
        'Read apps/schools-api/package.json, tsconfig.json, vitest.config.ts, Dockerfile, docker-entrypoint.sh, src/index.ts, src/app.ts, src/env.ts, src/auth.ts, src/middleware/auth.ts, src/middleware/roleGuard.ts, src/middleware/validate.ts — read ALL of these before writing anything',
        'Create apps/passes-api/package.json: copy schools-api package.json, change name to @hallpass/passes-api, add socket.io, ioredis, and bullmq to dependencies',
        'Create apps/passes-api/tsconfig.json: copy from schools-api verbatim',
        'Create apps/passes-api/vitest.config.ts and vitest.integration.config.ts: copy from schools-api, adjust any paths if needed',
        'Create apps/passes-api/src/index.ts: copy from schools-api, change port default to 3003',
        'Create apps/passes-api/src/app.ts: copy from schools-api verbatim (no routes mounted yet — routes will be added in Phase 3)',
        'Create apps/passes-api/src/env.ts: copy from schools-api, add REDIS_URL: z.string().url() to the Zod schema',
        'Create apps/passes-api/src/auth.ts: copy from schools-api verbatim',
        'Create apps/passes-api/src/middleware/auth.ts: copy requireAuth from schools-api verbatim',
        'Create apps/passes-api/src/middleware/roleGuard.ts: copy requireRole from schools-api verbatim',
        'Create apps/passes-api/src/middleware/validate.ts: copy validateBody/validateQuery/validateParams from schools-api verbatim',
        'Create apps/passes-api/Dockerfile: copy from schools-api, replace schools-api with passes-api, change EXPOSE port to 3003',
        'Create apps/passes-api/docker-entrypoint.sh: prisma migrate deploy then exec node apps/passes-api/dist/index.js (make it executable)',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm install && pnpm --filter @hallpass/passes-api build',
        'Fix any TypeScript or import errors until build exits 0',
        'Report files created and build result'
      ],
      outputFormat: 'List of files created and build result (success/failure with any errors fixed)'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const phase3EndpointsTask = defineTask('phase3-endpoints', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement REST endpoints with TDD',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Implement all passes-api REST endpoints using TDD: write tests first, then implement route handlers and Zod schemas.',
      context: {
        projectRoot: args.projectRoot,
        routeFile: 'apps/passes-api/src/routes/passes.ts',
        schemaFile: 'apps/passes-api/src/schemas/passes.ts',
        testFile: 'apps/passes-api/tests/routes/passes.test.ts',
        appFile: 'apps/passes-api/src/app.ts',
        templateRoute: 'apps/schools-api/src/routes/school.ts',
        endpoints: [
          'POST /passes — student requests a pass',
          'GET /passes — list passes (student: own only; teacher/admin: school-wide)',
          'GET /passes/:id — fetch single pass',
          'POST /passes/:id/approve — teacher approves pass → ACTIVE or WAITING',
          'POST /passes/:id/deny — teacher denies pass → DENIED',
          'POST /passes/:id/return — ACTIVE pass returned → COMPLETED',
          'POST /passes/:id/cancel — student cancels PENDING or WAITING pass → CANCELLED'
        ],
        businessLogic: {
          'POST /passes': [
            'Resolve active period: query SchoolCalendar for today, find Period covering current time (accounting for startBuffer/endBuffer)',
            'If no active period found → 422 "No active period"',
            'Check PassPolicy.maxPerInterval: count student passes in interval (DAY/WEEK/MONTH), if at limit → 422 "Pass limit reached"',
            'Check one-at-a-time: the partial unique index on (studentId) WHERE status IN (PENDING,WAITING,ACTIVE) will throw a unique constraint error if student has active pass — catch and return 409',
            'Check destination maxOccupancy via Redis slots: if slots available → status=PENDING; if no slots → status=WAITING',
            'Insert Pass record with schoolId from req.user.schoolId'
          ],
          'POST /passes/:id/approve': [
            'Only TEACHER or ADMIN role',
            'Pass must be PENDING status (not WAITING — WAITING passes are promoted automatically)',
            'Try to claim a Redis slot for the destination: if slot available → ACTIVE; if no slot → WAITING',
            'Update pass status and set approverId + approvedAt'
          ],
          'POST /passes/:id/deny': [
            'Only TEACHER or ADMIN role',
            'Pass must be PENDING or WAITING',
            'Update status to DENIED, set denierId + deniedAt'
          ],
          'POST /passes/:id/return': [
            'req.user must be the student (studentId) OR role TEACHER/ADMIN',
            'Pass must be ACTIVE',
            'Update status to COMPLETED, set returnedAt',
            'Release Redis slot (INCR), then call promoteFromQueue for this destination'
          ],
          'POST /passes/:id/cancel': [
            'req.user must be the student (studentId)',
            'Pass must be PENDING or WAITING',
            'Update status to CANCELLED, set cancellerId + cancelledAt',
            'If was WAITING, no slot to release. If was PENDING (not yet approved), no slot to release'
          ]
        },
        testPatterns: [
          'Use vitest + supertest for HTTP-level tests',
          'Mock prisma client using vi.mock or a test db helper (check how schools-api tests are structured)',
          'Read apps/schools-api/tests/ for test patterns before writing tests'
        ]
      },
      instructions: [
        'Read apps/schools-api/src/routes/school.ts and apps/schools-api/tests/routes/ to understand test and route patterns',
        'Read apps/passes-api/src/app.ts to understand current state of the app before adding routes',
        'Write tests in apps/passes-api/tests/routes/passes.test.ts FIRST (TDD)',
        'Tests should cover: happy path per endpoint, auth failures (401), role failures (403), invalid state transitions (400/409), not found (404)',
        'Create apps/passes-api/src/schemas/passes.ts with Zod schemas for: CreatePassBody (destinationId, note?), ApprovePassBody (approverNote?), DenyPassBody (approverNote?), CancelPassBody',
        'Create apps/passes-api/src/routes/passes.ts with all 7 endpoint handlers',
        'Mount the router in apps/passes-api/src/app.ts at /api/passes',
        'In POST /passes: implement period resolution, policy check, one-at-a-time enforcement (catch unique constraint error → 409), and slot check (stub slot check as always-available for now — Redis integrated in Phase 4)',
        'In POST /passes/:id/approve: stub Redis slot claim as always-succeeds for now',
        'In POST /passes/:id/return: stub slot release as no-op for now',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/passes-api test run 2>&1',
        'Fix any failing tests iteratively until all pass',
        'Report final test results'
      ],
      outputFormat: 'Summary of files created/modified and final test results (pass/fail counts)'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const phase4RedisTask = defineTask('phase4-redis', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement Redis slot counters with Upstash/ioredis',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Implement Redis-backed destination slot counters using ioredis, with lazy init, atomic DECR-based slot claiming, self-healing reconciliation, and queue promotion.',
      context: {
        projectRoot: args.projectRoot,
        redisFile: 'apps/passes-api/src/lib/redis.ts',
        slotsFile: 'apps/passes-api/src/lib/slots.ts',
        routeFile: 'apps/passes-api/src/routes/passes.ts',
        redisKeyPattern: 'slots:destination:{destinationId}',
        slotFunctions: {
          initSlots:
            'Lazy init: SET slots:destination:{id} {maxOccupancy} NX EX 86400 — only set if key does not exist. If destination has no maxOccupancy (null), skip (unlimited). Returns true if initialized, false if already existed.',
          claimSlot:
            'DECR slots:destination:{id}. If result >= 0, slot claimed (return true). If result < 0, INCR back (restore) and return false. If key does not exist, call initSlots first then retry once.',
          releaseSlot:
            'INCR slots:destination:{id}. If destination has maxOccupancy, cap at maxOccupancy (GET then SET if > maxOccupancy).',
          reconcileSlots:
            'Count DB rows WHERE destinationId={id} AND status=ACTIVE. SET slots:destination:{id} = maxOccupancy - activeCount. Handles self-healing on inconsistency.',
          promoteFromQueue:
            'Find the oldest WAITING pass for this destination (ORDER BY requestedAt ASC, LIMIT 1). If found and claimSlot succeeds, update pass status to ACTIVE, set approvedAt = now(). Emit socket event pass:promoted.'
        }
      },
      instructions: [
        'Create apps/passes-api/src/lib/redis.ts: import Redis from ioredis, create and export a single redis client using REDIS_URL env var. Handle connection errors gracefully (log and continue).',
        'Create apps/passes-api/src/lib/slots.ts: implement all 5 functions (initSlots, claimSlot, releaseSlot, reconcileSlots, promoteFromQueue) as described in the context',
        'promoteFromQueue will need access to prisma — import from @hallpass/db and import the socket emitter (leave a TODO comment for socket integration in Phase 5 for now)',
        'Update apps/passes-api/src/routes/passes.ts:',
        '  - POST /passes: replace stub slot check with real claimSlot call; if false → set status=WAITING',
        '  - POST /passes/:id/approve: replace stub with real claimSlot; if false → set status=WAITING',
        '  - POST /passes/:id/return: replace stub with releaseSlot + promoteFromQueue(destinationId)',
        '  - POST /passes/:id/cancel: if pass was WAITING, no slot release needed; if PENDING (not yet consuming a slot), no release needed',
        '  - POST /passes/:id/deny: if pass was ACTIVE (e.g., denied post-approval edge case), release slot',
        'Write tests in apps/passes-api/tests/lib/slots.test.ts using a mock Redis client (vi.mock ioredis or use ioredis-mock package)',
        'Add an integration test to passes.test.ts that seeds a destination with maxOccupancy=1, creates a pass (first one gets ACTIVE), creates second pass (should be WAITING)',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/passes-api test run 2>&1',
        'Fix any failures and re-run until all pass',
        'Report final test results and all files modified'
      ],
      outputFormat: 'Summary of files created/modified and final test results'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const phase5SocketTask = defineTask('phase5-socket', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Attach Socket.io for real-time pass state events',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Attach Socket.io to the Express HTTP server, add authenticated room joining, and emit pass state-transition events from all route handlers and the slots promotion function.',
      context: {
        projectRoot: args.projectRoot,
        socketFile: 'apps/passes-api/src/lib/socket.ts',
        indexFile: 'apps/passes-api/src/index.ts',
        routeFile: 'apps/passes-api/src/routes/passes.ts',
        slotsFile: 'apps/passes-api/src/lib/slots.ts',
        rooms: ['school:{schoolId}', 'user:{userId}'],
        events: [
          'pass:created — emitted after POST /passes inserts pass',
          'pass:queued — emitted when pass status becomes WAITING on create or approve',
          'pass:approved — emitted after POST /passes/:id/approve sets ACTIVE',
          'pass:denied — emitted after POST /passes/:id/deny',
          'pass:returned — emitted after POST /passes/:id/return',
          'pass:cancelled — emitted after POST /passes/:id/cancel',
          'pass:expired — emitted by BullMQ worker (Phase 6)',
          'pass:promoted — emitted by promoteFromQueue in slots.ts'
        ],
        authOnConnect:
          'On socket connect, extract headers from socket.handshake.headers, call auth.api.getSession({ headers }). If no session, disconnect socket. Otherwise attach user to socket.data.user and join rooms school:{user.schoolId} and user:{user.id}.'
      },
      instructions: [
        'Read apps/passes-api/src/index.ts and apps/passes-api/src/app.ts before making changes',
        'Create apps/passes-api/src/lib/socket.ts:',
        '  - Import Server from socket.io',
        '  - Export a function initSocket(httpServer) that creates and configures the Socket.io server',
        '  - Export a module-level io variable and an emitPassEvent(pass, event) helper function',
        '  - emitPassEvent broadcasts to school:{pass.schoolId} and user:{pass.studentId}',
        '  - Auth middleware: on connection, call auth.api.getSession, disconnect if no valid session, join rooms if authenticated',
        '  - Configure CORS for Socket.io to match the CORS_ORIGIN env var',
        'Update apps/passes-api/src/index.ts:',
        '  - Change from app.listen() to http.createServer(app)',
        '  - Call initSocket(httpServer) after creating the HTTP server',
        '  - Call httpServer.listen(port) instead of app.listen(port)',
        'Update apps/passes-api/src/routes/passes.ts:',
        '  - Import emitPassEvent from lib/socket.ts',
        '  - After each successful DB write, call emitPassEvent(updatedPass, event) with the correct event name',
        '  - For WAITING status: emit pass:queued',
        '  - For ACTIVE status on approve: emit pass:approved',
        'Update apps/passes-api/src/lib/slots.ts:',
        '  - Replace the TODO comment for socket integration with actual emitPassEvent(promotedPass, "pass:promoted") call',
        'Write an integration test in apps/passes-api/tests/integration/socket.test.ts:',
        '  - Use socket.io-client to connect and listen for pass:created',
        '  - POST /passes via supertest and verify the socket event fires with the correct pass payload',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/passes-api test run 2>&1',
        'Fix any failures until all tests pass',
        'Report all files modified and final test results'
      ],
      outputFormat: 'Summary of files created/modified and final test results'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const phase6BullmqTask = defineTask('phase6-bullmq', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement BullMQ pass expiry delayed queue',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Implement BullMQ pass expiry delayed jobs: schedule a job per pass at period end time, handle expiry transitions in the worker, and add a reconciliation endpoint for Cloud Scheduler.',
      context: {
        projectRoot: args.projectRoot,
        queueFile: 'apps/passes-api/src/lib/queue.ts',
        routeFile: 'apps/passes-api/src/routes/passes.ts',
        appFile: 'apps/passes-api/src/app.ts',
        queueName: 'pass-expiry',
        workerLogic: {
          onPENDING_or_WAITING: 'Update status to EXPIRED, set expiredAt = now(), emit pass:expired',
          onACTIVE:
            'Check if this is the last period of the school day: query SchoolCalendar for today and all Periods for that scheduleType after the current period end time. If no later periods today → update to COMPLETED, set returnedAt = now(), emit pass:returned. Otherwise → update to EXPIRED, emit pass:expired, release slot + promoteFromQueue',
          alreadyTerminal: 'Skip job if status is COMPLETED, CANCELLED, DENIED, or EXPIRED'
        },
        reconciliationEndpoint: {
          path: 'POST /internal/reconcile-expiry',
          role: 'SERVICE',
          logic: 'Find all passes WHERE status IN (PENDING, WAITING, ACTIVE) AND periodId IS NOT NULL. For each, find the Period end time. If period has already ended, process immediately. Otherwise, schedule a delayed BullMQ job (replace existing job if present using jobId = pass-{passId}).'
        }
      },
      instructions: [
        'Read apps/passes-api/src/lib/redis.ts to understand the Redis client before creating queue.ts',
        'Create apps/passes-api/src/lib/queue.ts:',
        '  - Import Queue and Worker from bullmq',
        '  - Use the same Redis connection as ioredis client (pass connection config from REDIS_URL)',
        '  - Export passExpiryQueue (Queue instance)',
        '  - Export function schedulePassExpiry(passId, periodEndTime): adds a delayed job with jobId=pass-{passId} and delay = periodEndTime.getTime() - Date.now()',
        '  - Export function startExpiryWorker(): creates a Worker for pass-expiry queue with the expiry handler logic described in workerLogic',
        '  - Worker handler: fetch pass by id, apply the state logic, emit Socket.io events, release slots as needed',
        'Update apps/passes-api/src/routes/passes.ts:',
        '  - In POST /passes handler: after inserting the pass, if periodId is resolved, compute period end time (Period.endTime + endBuffer) and call schedulePassExpiry(pass.id, endTime)',
        'Update apps/passes-api/src/index.ts:',
        '  - Call startExpiryWorker() after server starts',
        'Add reconciliation route to apps/passes-api/src/app.ts or a new src/routes/internal.ts:',
        '  - POST /internal/reconcile-expiry — requires SERVICE role, implements the reconciliation logic',
        'Write unit tests in apps/passes-api/tests/lib/queue.test.ts:',
        '  - Use bullmq test helpers or mock the Queue/Worker to verify: schedulePassExpiry creates a delayed job with correct delay, worker transitions PENDING → EXPIRED, worker transitions ACTIVE → COMPLETED on last period',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/passes-api test run 2>&1',
        'Fix any failures until all tests pass',
        'Report files created/modified and final test results'
      ],
      outputFormat: 'Summary of files created/modified and final test results'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const phase7DeployTask = defineTask('phase7-deploy', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Add CI/CD deploy jobs and update documentation',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior DevOps / TypeScript backend engineer',
      task: 'Add passes-api deploy jobs to .github/workflows/deploy.yml mirroring the schools-api jobs exactly, and update INFRA.md and README.md.',
      context: {
        projectRoot: args.projectRoot,
        deployFile: '.github/workflows/deploy.yml',
        infraDoc: 'docs/INFRA.md',
        readmeFile: 'README.md',
        newJobs: {
          'deploy-passes-api-dev': {
            mirrors: 'deploy-schools-api-dev',
            changes: {
              serviceName: 'passes-api-dev',
              dockerfile: 'apps/passes-api/Dockerfile',
              imageTag: 'passes-api'
            }
          },
          'deploy-passes-api-prod': {
            mirrors: 'deploy-schools-api-prod',
            changes: {
              serviceName: 'passes-api',
              dockerfile: 'apps/passes-api/Dockerfile',
              imageTag: 'passes-api'
            }
          }
        },
        passesApiInfraDetails: {
          port: 3003,
          cloudRunService: 'passes-api',
          dependencies: ['Neon Postgres (via DATABASE_URL)', 'Upstash Redis (via REDIS_URL)', 'Socket.io (attached to HTTP server)', 'BullMQ (delayed jobs via Redis)'],
          envVars: ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'REDIS_URL', 'CORS_ORIGIN', 'PORT']
        }
      },
      instructions: [
        'Read .github/workflows/deploy.yml in full before making any changes',
        'Read docs/INFRA.md and README.md before making any changes',
        'Add deploy-passes-api-dev job: copy the deploy-schools-api-dev job exactly, replacing service name, dockerfile path, and image tag references',
        'Add deploy-passes-api-prod job: copy the deploy-schools-api-prod job exactly, replacing service name, dockerfile path, and image tag references',
        'Make sure the new jobs have the same needs, triggers, and GCP configuration as their schools-api counterparts',
        'Update docs/INFRA.md: add a passes-api section describing the Cloud Run service, port 3003, dependencies (DB, Redis, Socket.io, BullMQ), and required env vars',
        'Update README.md: add passes-api to the services table (if one exists) or add a line in the Services section',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/passes-api build to confirm build still works',
        'Verify the YAML is syntactically valid by checking for obvious issues (proper indentation, correct job structure)',
        'Report all files changed with a summary of changes'
      ],
      outputFormat: 'Summary of all files changed and what was added/modified in each'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));
