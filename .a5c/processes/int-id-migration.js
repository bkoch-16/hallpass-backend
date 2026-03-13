/**
 * @process int-id-migration
 * @description Migrate all Prisma domain models from cuid String IDs to Int autoincrement IDs.
 * Updates tests first (TDD), then schema, application code, seed data, and Postman collection.
 * Targets: ScheduleType, Period, SchoolCalendar, Destination, PassPolicy (leaves Session/Account as-is).
 * @skill growing-outside-in-systems specializations/backend-development/skills/growing-outside-in-systems/SKILL.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs, ctx) {
  const projectRoot = '/Users/bkoch/development/hallpass-backend';

  // ============================================================================
  // PHASE 1: UPDATE TESTS (TDD-first)
  // ============================================================================

  ctx.log('info', 'Phase 1: Updating tests to use integer IDs');

  await ctx.task(updateTestsTask, { projectRoot });

  await ctx.breakpoint({
    question: 'Tests have been updated to use integer IDs. Review the changes and approve to proceed with schema migration?',
    title: 'Review: Updated Tests',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 2: UPDATE PRISMA SCHEMA + MIGRATION
  // ============================================================================

  ctx.log('info', 'Phase 2: Updating Prisma schema and creating migration');

  await ctx.task(updateSchemaTask, { projectRoot });

  await ctx.breakpoint({
    question: 'Prisma schema updated and migration created. Review schema changes and approve to proceed with application code updates?',
    title: 'Review: Schema Migration',
    context: { runId: ctx.runId }
  });

  // ============================================================================
  // PHASE 3: UPDATE APPLICATION CODE
  // ============================================================================

  ctx.log('info', 'Phase 3: Updating application code (zod schemas, routes, types)');

  await ctx.task(updateAppCodeTask, { projectRoot });

  // ============================================================================
  // PHASE 4: UPDATE SEED DATA + POSTMAN
  // ============================================================================

  ctx.log('info', 'Phase 4: Updating seed data and Postman collection');

  await ctx.task(updateSeedAndPostmanTask, { projectRoot });

  // ============================================================================
  // PHASE 5: RUN TESTS
  // ============================================================================

  ctx.log('info', 'Phase 5: Running tests to verify migration');

  await ctx.task(runTestsTask, { projectRoot });

  return { success: true };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

const updateTestsTask = defineTask('update-tests', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Update all tests to use integer IDs',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Update all test files in apps/schools-api/tests/ to use integer IDs instead of string cuid IDs for ScheduleType, Period, SchoolCalendar, Destination, and PassPolicy models.',
      context: {
        projectRoot: args.projectRoot,
        modelsToMigrate: ['ScheduleType', 'Period', 'SchoolCalendar', 'Destination', 'PassPolicy'],
        keepAsString: ['Session', 'Account'],
        currentIdType: 'string cuid (e.g. "cm3x...")',
        targetIdType: 'number (e.g. 1, 2, 3)',
        testDirs: [
          'apps/schools-api/tests/integration/',
          'apps/schools-api/tests/routes/',
          'apps/schools-api/tests/schemas/',
          'apps/schools-api/tests/middleware/'
        ]
      },
      instructions: [
        'Read ALL test files under apps/schools-api/tests/ before making any changes',
        'In integration tests: anywhere a cuid-like string ID is used for ScheduleType, Period, SchoolCalendar, Destination, or PassPolicy, replace with an integer (1, 2, 3, etc.)',
        'In schema tests (tests/schemas/): update Zod schema validation tests — valid cursor/id values should be numbers or numeric strings, invalid values should reflect the new int constraint',
        'In route unit tests (tests/routes/): update mock data to use integer IDs for the affected models',
        'In integration tests: update any helpers like seedScheduleType(), seedPeriod(), etc. that reference string IDs',
        'Do NOT change Session or Account IDs — those stay as strings (managed by Better Auth)',
        'Do NOT change District, School, User IDs — they are already Int',
        'Make sure scheduleTypeId references in Period and SchoolCalendar tests also change from string to number',
        'Update any TypeScript types in test helpers that reference these IDs as string to number',
        'After all edits, do a final pass to make sure no remaining cuid-style string IDs exist for the migrated models'
      ],
      outputFormat: 'Summary of all files changed and what was changed in each'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const updateSchemaTask = defineTask('update-schema', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Update Prisma schema and create migration',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Update packages/db/prisma/schema.prisma to change ScheduleType, Period, SchoolCalendar, Destination, and PassPolicy IDs from String cuid to Int autoincrement. Then generate a Prisma migration.',
      context: {
        projectRoot: args.projectRoot,
        schemaFile: 'packages/db/prisma/schema.prisma',
        modelsToMigrate: ['ScheduleType', 'Period', 'SchoolCalendar', 'Destination', 'PassPolicy'],
        keepAsString: ['Session', 'Account'],
        migrationsDir: 'packages/db/prisma/migrations/',
        migrationCommand: 'pnpm --filter @hallpass/db exec prisma migrate dev --name int-id-migration --create-only'
      },
      instructions: [
        'Read the full schema.prisma file first',
        'Change `id String @id @default(cuid())` to `id Int @id @default(autoincrement())` for: ScheduleType, Period, SchoolCalendar, Destination, PassPolicy',
        'SchoolCalendar currently has no @id — add `id Int @id @default(autoincrement())`',
        'Update all foreign key fields that reference these models: Period.scheduleTypeId should change from String to Int, SchoolCalendar.scheduleTypeId should change from String? to Int?',
        'Do NOT change Session.id or Account.id — those stay as String cuid',
        'After updating the schema, run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/db exec prisma migrate dev --name int-id-migration --create-only',
        'This creates a migration SQL file — do NOT run migrate deploy yet (just --create-only)',
        'Report the migration file path and its SQL content in the summary'
      ],
      outputFormat: 'Summary of schema changes and migration file path/content'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const updateAppCodeTask = defineTask('update-app-code', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Update application code to use integer IDs',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Update all application code in apps/schools-api/src/ to use integer IDs for ScheduleType, Period, SchoolCalendar, Destination, and PassPolicy.',
      context: {
        projectRoot: args.projectRoot,
        srcDir: 'apps/schools-api/src/',
        modelsToMigrate: ['ScheduleType', 'Period', 'SchoolCalendar', 'Destination', 'PassPolicy'],
        affectedDirs: [
          'apps/schools-api/src/schemas/',
          'apps/schools-api/src/routes/',
          'apps/schools-api/src/middleware/'
        ]
      },
      instructions: [
        'Read ALL files under apps/schools-api/src/ before making any changes',
        'In Zod schemas (src/schemas/): update any id/cursor validation that uses string regex to use z.coerce.number().int().positive() — specifically for ScheduleType, Period, Destination, PassPolicy, SchoolCalendar IDs',
        'In route handlers (src/routes/): update any places that treat scheduleTypeId, destinationId, etc. as strings — they should now be parsed as numbers (they come from URL params as strings but should be coerced to Int)',
        'Check src/routes/scheduleType.ts, period.ts, calendar.ts, destination.ts, policy.ts for any string ID handling',
        'Update any TypeScript types or interfaces that declare these IDs as string — change to number',
        'Make sure URL param parsing correctly coerces string params to numbers where needed',
        'Run: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/schools-api exec tsc --noEmit to check for type errors',
        'Fix any type errors found before finishing'
      ],
      outputFormat: 'Summary of all files changed, and result of TypeScript type check'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const updateSeedAndPostmanTask = defineTask('update-seed-postman', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Update seed data and Postman collection',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Update the Prisma seed file and all Postman request YAML files to reflect integer IDs from real seed data.',
      context: {
        projectRoot: args.projectRoot,
        seedFile: 'packages/db/prisma/seed.ts',
        postmanDir: 'postman/collections/hallpass/Schools-API/',
        seedData: {
          district: { id: 1, name: 'Demo District' },
          school: { id: 1, name: 'Demo High School', districtId: 1 },
          scheduleTypes: [
            { id: 1, name: 'Standard Day' },
            { id: 2, name: 'Late Start' }
          ],
          destinations: [
            { id: 1, name: 'Library', maxOccupancy: 20 },
            { id: 2, name: 'Bathroom', maxOccupancy: null },
            { id: 3, name: "Nurse's Office", maxOccupancy: 5 },
            { id: 4, name: 'Office', maxOccupancy: null }
          ],
          policy: { id: 1, schoolId: 1 }
        }
      },
      instructions: [
        'Read the full seed.ts file — check if any hardcoded cuid IDs exist; if so, remove them since Int IDs are auto-assigned',
        'Update seed.ts to use connect-by-id patterns with integer IDs where needed',
        'Read ALL Postman YAML files under postman/collections/hallpass/Schools-API/',
        'Update every Postman request body and URL path params to use real integer IDs from the seed data above',
        'For example: GET /api/schools/1, GET /api/schools/1/schedule-types/1, GET /api/schools/1/calendar',
        'For Schedule Types requests: use schoolId=1, scheduleTypeId=1 or 2',
        'For Periods requests: use schoolId=1, scheduleTypeId=1',
        'For Destinations: use schoolId=1, destinationId=1',
        'For Policy: use schoolId=1',
        'For Calendar: use schoolId=1',
        'Make sure all Create/Update/Delete requests have valid integer IDs in their URL paths',
        'Ensure Postman request bodies use realistic values that match the seed data structure'
      ],
      outputFormat: 'Summary of seed.ts changes and list of all Postman files updated with their key changes'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const runTestsTask = defineTask('run-tests', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Run tests and fix failures',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript backend engineer',
      task: 'Run the schools-api test suite. Fix any failing tests. Repeat until all tests pass.',
      context: {
        projectRoot: args.projectRoot,
        testCommand: 'cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/schools-api test run 2>&1',
        maxIterations: 3
      },
      instructions: [
        'Run the test command: cd /Users/bkoch/development/hallpass-backend && pnpm --filter @hallpass/schools-api test run 2>&1',
        'If tests fail, read the failing test files and the corresponding source files to diagnose the issue',
        'Fix only what is needed to make the tests pass — do not refactor or over-engineer',
        'Re-run tests after each fix',
        'Continue until all tests pass or you have attempted 3 fix cycles',
        'Report final test results: pass/fail counts and any remaining failures with their root cause'
      ],
      outputFormat: 'Final test results with pass/fail counts and summary of any fixes applied'
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));
