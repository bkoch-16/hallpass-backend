/**
 * @process demo-ui-prod-only
 * @description Refactor demo-ui to remove Dev stage: filter generate-demo.ts to prod-only,
 *              update index.html about section, and regenerate config.js
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs, ctx) {
  const prompt = (inputs ?? {}).prompt ?? '';

  ctx.log('info', 'Phase 1: Apply refactoring changes to demo-ui');

  await ctx.task(applyChangesTask, { prompt });

  ctx.log('info', 'Phase 2: Review breakpoint');

  await ctx.breakpoint({
    title: 'Review demo-ui changes',
    question: [
      'The following changes have been applied to demo-ui:',
      '',
      '1. `scripts/generate-demo.ts` — added a filter to exclude Dev stage from generated config',
      '2. `apps/demo-ui/index.html` — removed the Dev environment bullet point from the about section',
      '3. `apps/demo-ui/config.js` — regenerated (Dev stage and Dev baseUrls removed)',
      '',
      'Please review the changes. Approve to commit, or reject to cancel.'
    ].join('\n'),
    context: { runId: ctx.runId }
  });

  ctx.log('info', 'Phase 3: Commit changes');

  const commitResult = await ctx.task(commitChangesTask, {});

  return {
    success: true,
    summary: commitResult.summary ?? 'demo-ui refactored to prod-only'
  };
}

// ---------------------------------------------------------------------------
// Task: Apply all refactoring changes
// ---------------------------------------------------------------------------

const applyChangesTask = defineTask('apply-demo-ui-changes', (args) => ({
  kind: 'agent',
  title: 'Apply demo-ui prod-only refactoring',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior TypeScript developer',
      task: 'Apply the following refactoring changes to the hallpass-backend repo at /Users/bkoch/development/hallpass-backend',
      context: {
        userRequest: args.prompt,
        repoRoot: '/Users/bkoch/development/hallpass-backend'
      },
      instructions: [
        '1. Edit `scripts/generate-demo.ts`: In the `parseEnvironments()` function, after building the `stages` array (around line 147-149), add a filter to exclude stages matching /^(dev|local)$/i. Only keep stages like Prod, Staging, Beta. The filtered line should look like: const stages = [...stageSet].sort(...).filter(s => !/^(dev|local)$/i.test(s));',
        '2. Edit `apps/demo-ui/index.html`: Remove the list item "<li><strong>Dev environment</strong> is actively used for development and testing and may be less stable than Prod.</li>" from the info-notes ul. Also update the "Getting started" paragraph to remove the reference to stage selection being needed (since Prod will be the only option), changing "Select a stage (Prod is more stable), then go to" to just "Go to".',
        '3. Run `pnpm tsx scripts/generate-demo.ts` from the repo root to regenerate `apps/demo-ui/config.js`. Verify that the output config.js no longer contains any "Dev" stage or Dev baseUrls.',
        '4. Verify `apps/demo-ui/app.js` line 230: it does `if (CONFIG.stages.includes(\'Prod\')) sel.value = \'Prod\';` — with only Prod in stages this still works correctly, no change needed.',
        'Return a summary of exactly what was changed.'
      ],
      outputFormat: 'JSON with fields: summary (string), filesChanged (array of strings)'
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'filesChanged'],
      properties: {
        summary: { type: 'string' },
        filesChanged: { type: 'array', items: { type: 'string' } }
      }
    }
  }
}));

// ---------------------------------------------------------------------------
// Task: Commit changes
// ---------------------------------------------------------------------------

const commitChangesTask = defineTask('commit-demo-ui-changes', () => ({
  kind: 'agent',
  title: 'Commit demo-ui refactoring',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Developer',
      task: 'Commit the demo-ui prod-only refactoring changes in the hallpass-backend repo',
      context: { repoRoot: '/Users/bkoch/development/hallpass-backend' },
      instructions: [
        'Run `git -C /Users/bkoch/development/hallpass-backend add apps/demo-ui/config.js apps/demo-ui/index.html scripts/generate-demo.ts`',
        'Run `git -C /Users/bkoch/development/hallpass-backend commit -m "remove dev stage from demo-ui"` (no Co-Authored-By line)',
        'Return the commit hash and a short summary.'
      ],
      outputFormat: 'JSON with fields: summary (string), commitHash (string)'
    },
    outputSchema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
        commitHash: { type: 'string' }
      }
    }
  }
}));
