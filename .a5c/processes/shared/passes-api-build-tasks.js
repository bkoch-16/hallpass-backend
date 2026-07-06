import { defineTask } from '@a5c-ai/babysitter-sdk';

// Shared build-and-test shell task used by passes-api process files.
// Both fix-code-review-issues.js and fix-socket-adapter-and-infra-doc.js
// use an identical definition — extracted here to avoid duplication.
export const buildAndTestTask = defineTask('build-and-test', (args) => ({
  kind: 'shell',
  title: `Build + unit test — attempt ${args.attempt}`,
  command: [
    'pnpm --filter @hallpass/passes-api build 2>&1',
    'echo "BUILD_EXIT:$?"',
    'pnpm --filter @hallpass/passes-api test run 2>&1',
    'echo "TEST_EXIT:$?"',
  ].join(' && '),
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
    const buildFailed = stdout.includes('BUILD_EXIT:1') || stdout.includes('error TS');
    const testFailed = stdout.includes('TEST_EXIT:1') || stdout.includes(' failed');
    return { passed: !buildFailed && !testFailed, output: stdout };
  },
}));

// Factory for fix-build-errors task. The two process files differ in
// relevantFiles and commonCauses, so those are passed as parameters.
export function makeFixBuildErrorsTask({ relevantFiles, commonCauses }) {
  return defineTask('fix-build-errors', (args, taskCtx) => ({
    kind: 'agent',
    title: `Fix build/test failures (iteration ${args.iteration})`,
    agent: {
      name: 'general-purpose',
      prompt: {
        role: 'Senior TypeScript backend engineer fixing build and test failures',
        task: 'Fix the failing TypeScript build or unit test errors in apps/passes-api.',
        context: {
          buildTestOutput: args.testOutput,
          relevantFiles,
          commonCauses,
        },
        instructions: [
          'Read the build/test output carefully to identify the specific error.',
          'Read the relevant source files to understand the current state.',
          'Fix only the specific failure — do not rewrite passing code.',
          'Verify the fix makes sense before returning.',
          'Return a description of what was wrong and what was changed.',
        ],
        outputFormat: 'JSON with fixedIssues (string[]), filesModified (string[])',
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
    io: {
      inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
      outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
    },
  }));
}
