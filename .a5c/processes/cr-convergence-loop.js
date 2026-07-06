/**
 * @process cr-convergence-loop
 * @description Autonomous CR → plan → approve → implement → test → commit loop.
 * Converges when the CR agent finds no issues worth fixing. Human escalation
 * fires only when both the CR agent AND the approval agent independently agree
 * that the situation requires human judgment.
 *
 * Loop shape (up to 5 iterations):
 *   1. CR agent       → reads git diff, writes cr-findings.json
 *   2. Plan agent     → reads cr-findings.json, writes fix-plan-v1.json
 *   3. Approval agent → reads both, writes approval-v1.json (re-plans up to 3×)
 *   4. Impl agent     → reads final fix-plan, applies changes
 *   5. Quality gates  → pnpm build + lint + test (convergence loop up to 3×)
 *   6. Commit         → git-commit skill
 *   → back to 1
 *
 * All cross-agent state lives in artifact files — no context is shared across
 * iterations or between agents. The loop is fully pauseable/resumable.
 *
 * @agent general-purpose specializations/backend-development/agents/
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = '/Users/bkoch/development/hallpass-backend';
const BASE_BRANCH = 'develop';
const MAX_ITERATIONS = 5;
const MAX_REPLAN_ATTEMPTS = 3;
const MAX_QUALITY_ATTEMPTS = 3;

// ============================================================================
// MAIN PROCESS
// ============================================================================

export async function process(inputs, ctx) {
  const artifactsDir = path.join(PROJECT_ROOT, '.a5c/runs', ctx.runId, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  // Persistent loop state — survives pauses and session switches
  const loopStatePath = path.join(artifactsDir, 'loop-state.json');
  const loopState = {
    status: 'running',
    currentIteration: 0,
    completedIterations: [],
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(loopStatePath, JSON.stringify(loopState, null, 2));

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const iterDir = path.join(artifactsDir, `iteration-${iteration}`);
    fs.mkdirSync(iterDir, { recursive: true });

    loopState.currentIteration = iteration;
    loopState.iterationStartedAt = new Date().toISOString();
    fs.writeFileSync(loopStatePath, JSON.stringify(loopState, null, 2));
    ctx.log('info', `=== CR Convergence Loop — Iteration ${iteration}/${MAX_ITERATIONS} ===`);

    // ─── 1. CODE REVIEW ────────────────────────────────────────────────────
    const crResult = await ctx.task(codeReviewTask, {
      projectRoot: PROJECT_ROOT,
      baseBranch: BASE_BRANCH,
      iterDir,
      iteration,
    });

    if (crResult.done) {
      loopState.status = 'converged';
      loopState.finishedAt = new Date().toISOString();
      loopState.totalIterations = iteration - 1;
      fs.writeFileSync(loopStatePath, JSON.stringify(loopState, null, 2));
      ctx.log('info', `CR agent found no issues worth fixing after ${iteration - 1} iteration(s). Done.`);
      break;
    }

    ctx.log('info', `CR found ${crResult.findingsCount} finding(s) — proceeding to planning`);
    const crFindingsPath = path.join(iterDir, 'cr-findings.json');

    // ─── 2. FIX PLANNING ───────────────────────────────────────────────────
    let planResult = await ctx.task(fixPlanningTask, {
      projectRoot: PROJECT_ROOT,
      crFindingsPath,
      iterDir,
      iteration,
      planVersion: 1,
    });

    let currentPlanPath = path.join(iterDir, 'fix-plan-v1.json');

    // ─── 3. APPROVAL LOOP (re-plan up to MAX_REPLAN_ATTEMPTS) ──────────────
    let approvalResult = await ctx.task(planApprovalTask, {
      projectRoot: PROJECT_ROOT,
      crFindingsPath,
      fixPlanPath: currentPlanPath,
      iterDir,
      iteration,
      planVersion: 1,
    });

    let replanCount = 0;
    let escalated = false;

    while (!approvalResult.approved && replanCount < MAX_REPLAN_ATTEMPTS) {
      // Escalate only when BOTH agents independently flag it
      if (approvalResult.needsEscalation && planResult.needsEscalation) {
        ctx.log('warn', `Both agents agree escalation needed — pausing for human review`);
        const bpResult = await ctx.breakpoint({
          title: `Human Escalation Required — Iteration ${iteration}`,
          question: [
            'Both the code review agent and the planning approval agent independently flagged this as requiring human input.',
            '',
            `CR/Approval agent: ${approvalResult.escalationReason ?? '(see approval-v' + (replanCount + 1) + '.json)'}`,
            `Planning agent: ${planResult.escalationReason ?? '(see fix-plan-v' + (replanCount + 1) + '.json)'}`,
            '',
            `Artifact directory: ${iterDir}`,
            '',
            'Approve to continue to implementation with the current plan, or reject to skip this iteration.',
          ].join('\n'),
          context: { runId: ctx.runId, iterDir, iteration },
        });
        escalated = true;
        if (!bpResult?.approved) {
          ctx.log('warn', 'User rejected escalation — skipping to next iteration');
        }
        break;
      }

      replanCount++;
      ctx.log('warn', `Plan rejected (attempt ${replanCount}/${MAX_REPLAN_ATTEMPTS}) — re-planning`);

      const rejectionFeedbackPath = path.join(iterDir, `approval-v${replanCount}.json`);
      const nextVersion = replanCount + 1;

      planResult = await ctx.task(rePlanTask, {
        projectRoot: PROJECT_ROOT,
        crFindingsPath,
        previousPlanPath: currentPlanPath,
        rejectionFeedbackPath,
        iterDir,
        iteration,
        planVersion: nextVersion,
      });

      currentPlanPath = path.join(iterDir, `fix-plan-v${nextVersion}.json`);

      approvalResult = await ctx.task(planApprovalTask, {
        projectRoot: PROJECT_ROOT,
        crFindingsPath,
        fixPlanPath: currentPlanPath,
        iterDir,
        iteration,
        planVersion: nextVersion,
      });
    }

    // Re-plan exhausted and still not approved (single-agent flag or just disagreement)
    if (!approvalResult.approved && !escalated) {
      ctx.log('warn', `Plan approval exhausted after ${MAX_REPLAN_ATTEMPTS} re-plan attempts`);
      const bpResult = await ctx.breakpoint({
        title: `Plan Approval Exhausted — Iteration ${iteration}`,
        question: [
          `The fix plan could not be approved after ${MAX_REPLAN_ATTEMPTS} re-plan attempts.`,
          '',
          `Last rejection: ${approvalResult.feedback}`,
          `Artifact directory: ${iterDir}`,
          '',
          'Approve to proceed with the current plan, or reject to skip this iteration.',
        ].join('\n'),
        context: { runId: ctx.runId, iterDir, iteration },
      });
      if (!bpResult?.approved) {
        ctx.log('warn', 'Skipping iteration per user decision');
        continue;
      }
    }

    // ─── 4. IMPLEMENTATION ─────────────────────────────────────────────────
    ctx.log('info', `Plan approved — implementing fixes`);
    await ctx.task(implementTask, {
      projectRoot: PROJECT_ROOT,
      fixPlanPath: currentPlanPath,
      iterDir,
      iteration,
    });

    // ─── 5. QUALITY GATES (convergence loop) ───────────────────────────────
    let qualityPassed = false;
    let qualityAttempt = 0;

    while (!qualityPassed && qualityAttempt < MAX_QUALITY_ATTEMPTS) {
      qualityAttempt++;
      ctx.log('info', `Quality gates — attempt ${qualityAttempt}/${MAX_QUALITY_ATTEMPTS}`);

      const qResult = await ctx.task(qualityGatesTask, {
        projectRoot: PROJECT_ROOT,
        iterDir,
        iteration,
        attempt: qualityAttempt,
      });

      qualityPassed = qResult.passed === true;

      if (!qualityPassed && qualityAttempt < MAX_QUALITY_ATTEMPTS) {
        ctx.log('warn', `Quality gates failed — applying targeted fixes`);
        await ctx.task(fixQualityTask, {
          projectRoot: PROJECT_ROOT,
          qualityOutputPath: path.join(iterDir, `quality-gates-attempt-${qualityAttempt}.json`),
          iterDir,
          iteration,
          attempt: qualityAttempt,
        });
      }
    }

    if (!qualityPassed) {
      const bpResult = await ctx.breakpoint({
        title: `Quality Gates Still Failing — Iteration ${iteration}`,
        question: [
          `Build/lint/tests are still failing after ${MAX_QUALITY_ATTEMPTS} fix attempts.`,
          `Artifact directory: ${iterDir}`,
          '',
          'Approve to commit as-is (not recommended), or reject to stop the run and investigate.',
        ].join('\n'),
        context: { runId: ctx.runId, iterDir, iteration },
      });
      if (!bpResult?.approved) {
        loopState.status = 'failed';
        loopState.failedAt = new Date().toISOString();
        loopState.failReason = `Quality gates failed at iteration ${iteration}`;
        fs.writeFileSync(loopStatePath, JSON.stringify(loopState, null, 2));
        break;
      }
    }

    // ─── 6. COMMIT ─────────────────────────────────────────────────────────
    ctx.log('info', `Committing iteration ${iteration} changes`);
    await ctx.task(commitTask, {
      projectRoot: PROJECT_ROOT,
      crFindingsPath,
      implementationPath: path.join(iterDir, 'implementation.json'),
      iterDir,
      iteration,
    });

    loopState.completedIterations.push(iteration);
    loopState.lastCompletedAt = new Date().toISOString();
    fs.writeFileSync(loopStatePath, JSON.stringify(loopState, null, 2));
    ctx.log('info', `Iteration ${iteration} complete — looping back to CR`);
  }

  return {
    status: loopState.status,
    completedIterations: loopState.completedIterations.length,
    loopStatePath,
  };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

// ─── 1. Code Review ──────────────────────────────────────────────────────────

const codeReviewTask = defineTask('cr-code-review', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Code Review (${args.baseBranch}...HEAD)`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior code reviewer',
      task: `Perform a code review of the current branch diff against ${args.baseBranch} and write structured findings to a file.`,
      context: {
        projectRoot: args.projectRoot,
        baseBranch: args.baseBranch,
        outputFile: path.join(args.iterDir, 'cr-findings.json'),
      },
      instructions: [
        `Run: git -C "${args.projectRoot}" diff ${args.baseBranch}...HEAD`,
        'Review the diff for exactly three categories:',
        '  1. Correctness — logic errors, off-by-one, unhandled edge cases, broken error handling, missing null checks, incorrect runtime behavior',
        '  2. DRY — duplicated logic that already exists elsewhere, repeated literals that should be constants, inline logic duplicating a utility',
        '  3. Idiomatic patterns — find 2-3 analogous files in the repo for anything not in CLAUDE.md; flag deviations from established naming, structure, or how similar problems are solved',
        'Do NOT flag stylistic preferences, formatting, or anything you would not block a PR over.',
        `Write ALL findings to: ${path.join(args.iterDir, 'cr-findings.json')}`,
        'Use this exact JSON schema:',
        '  {',
        '    "done": boolean,          // true if NO findings worth fixing (empty diff, style-only, or converged)',
        '    "findingsCount": number,',
        '    "findings": [',
        '      {',
        '        "id": "finding-N",',
        '        "severity": "critical|high|medium|low",',
        '        "file": "relative/path/to/file.ts",',
        '        "line": number | null,',
        '        "description": "What the problem is and why it matters",',
        '        "suggestion": "Concrete fix recommendation"',
        '      }',
        '    ],',
        '    "needsEscalation": boolean,  // true ONLY if findings require architectural decisions beyond typical code fixes',
        '    "escalationReason": "string | null"',
        '  }',
        'Set done=true and findingsCount=0 only when there is genuinely nothing worth changing.',
        'Return a result object with: done, findingsCount, needsEscalation, escalationReason.',
      ],
      outputFormat: 'JSON: { done: boolean, findingsCount: number, needsEscalation: boolean, escalationReason: string | null }',
    },
    outputSchema: {
      type: 'object',
      required: ['done', 'findingsCount'],
      properties: {
        done: { type: 'boolean' },
        findingsCount: { type: 'number' },
        needsEscalation: { type: 'boolean' },
        escalationReason: { type: ['string', 'null'] },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 2. Fix Planning ─────────────────────────────────────────────────────────

const fixPlanningTask = defineTask('cr-fix-planning', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Fix Planning v${args.planVersion}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior software engineer producing a precise, file-level fix plan',
      task: 'Read the code review findings and produce a concrete fix plan — no vague "refactor" instructions, only specific code changes.',
      context: {
        projectRoot: args.projectRoot,
        crFindingsPath: args.crFindingsPath,
        outputFile: path.join(args.iterDir, `fix-plan-v${args.planVersion}.json`),
      },
      instructions: [
        `Read the CR findings from: ${args.crFindingsPath}`,
        'For each finding, produce a fix that specifies:',
        '  - Which file(s) to modify (relative path from project root)',
        '  - What exactly to change — actual code, not just intent',
        '  - Any ordering constraints between fixes',
        'Group fixes by file to minimize context switching during implementation.',
        'Each fix must be minimal and targeted — no scope creep beyond the finding.',
        `Write the fix plan to: ${path.join(args.iterDir, `fix-plan-v${args.planVersion}.json`)}`,
        'Use this exact JSON schema:',
        '  {',
        '    "fixes": [',
        '      {',
        '        "findingId": "finding-N",',
        '        "file": "relative/path/to/file.ts",',
        '        "changeDescription": "Precise one-line description of the change",',
        '        "approach": "Detailed implementation approach with example code where helpful"',
        '      }',
        '    ],',
        '    "fileGroups": [',
        '      {',
        '        "files": ["file1.ts"],',
        '        "findingIds": ["finding-1", "finding-2"],',
        '        "note": "reason why these are grouped"',
        '      }',
        '    ],',
        '    "needsEscalation": boolean,  // true only if a fix requires architectural decisions you cannot safely make',
        '    "escalationReason": "string | null"',
        '  }',
        'Return a result object with: fixCount, needsEscalation, escalationReason.',
      ],
      outputFormat: 'JSON: { fixCount: number, needsEscalation: boolean, escalationReason: string | null }',
    },
    outputSchema: {
      type: 'object',
      required: ['fixCount'],
      properties: {
        fixCount: { type: 'number' },
        needsEscalation: { type: 'boolean' },
        escalationReason: { type: ['string', 'null'] },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 3. Plan Approval ────────────────────────────────────────────────────────

const planApprovalTask = defineTask('cr-plan-approval', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Plan Approval v${args.planVersion}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'critical senior code reviewer validating whether a fix plan adequately addresses review findings',
      task: 'Read the CR findings and the fix plan. Decide whether the plan correctly and completely addresses every finding.',
      context: {
        projectRoot: args.projectRoot,
        crFindingsPath: args.crFindingsPath,
        fixPlanPath: args.fixPlanPath,
        outputFile: path.join(args.iterDir, `approval-v${args.planVersion}.json`),
      },
      instructions: [
        `Read the CR findings from: ${args.crFindingsPath}`,
        `Read the fix plan from: ${args.fixPlanPath}`,
        'For each finding, verify:',
        '  - The plan addresses it (not just acknowledges it)',
        '  - The proposed approach is technically correct and will not introduce new bugs',
        '  - No findings are missed, glossed over, or oversimplified',
        '  - No over-engineering — each fix should be minimal and targeted',
        'Approve only if you are confident ALL findings are properly addressed.',
        `Write your approval decision to: ${path.join(args.iterDir, `approval-v${args.planVersion}.json`)}`,
        'Use this exact JSON schema:',
        '  {',
        '    "approved": boolean,',
        '    "feedback": "concise summary of why approved or rejected",',
        '    "inadequateFindings": [',
        '      { "findingId": "finding-N", "issue": "why the proposed fix is inadequate" }',
        '    ],',
        '    "needsEscalation": boolean,  // true ONLY if rejection is due to something requiring human architectural input',
        '    "escalationReason": "string | null"',
        '  }',
        'Return a result object with: approved, feedback, needsEscalation, escalationReason.',
      ],
      outputFormat: 'JSON: { approved: boolean, feedback: string, needsEscalation: boolean, escalationReason: string | null }',
    },
    outputSchema: {
      type: 'object',
      required: ['approved', 'feedback'],
      properties: {
        approved: { type: 'boolean' },
        feedback: { type: 'string' },
        needsEscalation: { type: 'boolean' },
        escalationReason: { type: ['string', 'null'] },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 3b. Re-Plan (on rejection) ──────────────────────────────────────────────

const rePlanTask = defineTask('cr-replan', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Re-Plan v${args.planVersion}`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior software engineer revising a rejected fix plan based on reviewer feedback',
      task: 'Read the original CR findings, the rejected plan, and the rejection feedback. Produce a revised plan that addresses every rejection point.',
      context: {
        projectRoot: args.projectRoot,
        crFindingsPath: args.crFindingsPath,
        previousPlanPath: args.previousPlanPath,
        rejectionFeedbackPath: args.rejectionFeedbackPath,
        outputFile: path.join(args.iterDir, `fix-plan-v${args.planVersion}.json`),
      },
      instructions: [
        `Read the CR findings from: ${args.crFindingsPath}`,
        `Read the rejected plan from: ${args.previousPlanPath}`,
        `Read the rejection feedback from: ${args.rejectionFeedbackPath}`,
        'Address EVERY point in the rejection feedback — do not ignore any rejection reason.',
        'Do not regress on parts of the plan that were already adequate.',
        `Write the revised plan to: ${path.join(args.iterDir, `fix-plan-v${args.planVersion}.json`)}`,
        'Use the same JSON schema as the original fix plan.',
        'Return a result object with: fixCount, needsEscalation, escalationReason.',
      ],
      outputFormat: 'JSON: { fixCount: number, needsEscalation: boolean, escalationReason: string | null }',
    },
    outputSchema: {
      type: 'object',
      required: ['fixCount'],
      properties: {
        fixCount: { type: 'number' },
        needsEscalation: { type: 'boolean' },
        escalationReason: { type: ['string', 'null'] },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 4. Implementation ───────────────────────────────────────────────────────

const implementTask = defineTask('cr-implement', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Implement Fixes`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior software engineer implementing approved code fixes',
      task: 'Read the approved fix plan and implement every fix precisely as described. No extra changes, no opportunistic refactoring.',
      context: {
        projectRoot: args.projectRoot,
        fixPlanPath: args.fixPlanPath,
        implementationOutputFile: path.join(args.iterDir, 'implementation.json'),
      },
      instructions: [
        `Read the approved fix plan from: ${args.fixPlanPath}`,
        'Implement each fix as described — match the approach exactly.',
        'Process files in the order given by fileGroups if present.',
        'If a fix description is ambiguous, choose the most conservative interpretation.',
        'Do NOT modify any file not mentioned in the fix plan.',
        `Write an implementation summary to: ${path.join(args.iterDir, 'implementation.json')}`,
        'Use this JSON schema:',
        '  {',
        '    "appliedFixes": ["finding-N — one-line description of what changed"],',
        '    "modifiedFiles": ["relative/path.ts"],',
        '    "skippedFixes": [{ "findingId": "finding-N", "reason": "..." }],',
        '    "notes": "any implementation notes worth capturing"',
        '  }',
        'Return a result object with: appliedCount, modifiedFiles (array of paths), skippedCount.',
      ],
      outputFormat: 'JSON: { appliedCount: number, modifiedFiles: string[], skippedCount: number }',
    },
    outputSchema: {
      type: 'object',
      required: ['appliedCount', 'modifiedFiles'],
      properties: {
        appliedCount: { type: 'number' },
        modifiedFiles: { type: 'array', items: { type: 'string' } },
        skippedCount: { type: 'number' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 5a. Quality Gates ───────────────────────────────────────────────────────

const qualityGatesTask = defineTask('cr-quality-gates', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Quality Gates (attempt ${args.attempt})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'QA engineer running quality gate commands and capturing results',
      task: 'Run pnpm build, pnpm lint, and pnpm test in the project. Report exactly what passed and what failed.',
      context: {
        projectRoot: args.projectRoot,
        outputFile: path.join(args.iterDir, `quality-gates-attempt-${args.attempt}.json`),
      },
      instructions: [
        `Working directory: ${args.projectRoot}`,
        'Run these three commands in order, capturing all output:',
        '  1. pnpm build',
        '  2. pnpm lint',
        '  3. pnpm test run',
        'Stop on the first failure — do not run subsequent commands if an earlier one fails.',
        'Capture both stdout and stderr for any failing command.',
        `Write results to: ${path.join(args.iterDir, `quality-gates-attempt-${args.attempt}.json`)}`,
        'Use this JSON schema:',
        '  {',
        '    "passed": boolean,        // true only if ALL three commands succeeded',
        '    "buildPassed": boolean,',
        '    "lintPassed": boolean,',
        '    "testPassed": boolean,',
        '    "failedCommand": "build|lint|test|null",',
        '    "output": "captured error output (trimmed to last 2000 chars if long)"',
        '  }',
        'Return a result object with: passed, buildPassed, lintPassed, testPassed, failedCommand.',
      ],
      outputFormat: 'JSON: { passed: boolean, buildPassed: boolean, lintPassed: boolean, testPassed: boolean, failedCommand: string | null }',
    },
    outputSchema: {
      type: 'object',
      required: ['passed'],
      properties: {
        passed: { type: 'boolean' },
        buildPassed: { type: 'boolean' },
        lintPassed: { type: 'boolean' },
        testPassed: { type: 'boolean' },
        failedCommand: { type: ['string', 'null'] },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 5b. Fix Quality Gate Failures ───────────────────────────────────────────

const fixQualityTask = defineTask('cr-fix-quality', (args, taskCtx) => ({
  kind: 'agent',
  title: `[Iter ${args.iteration}] Fix Quality Failures (attempt ${args.attempt})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'senior engineer debugging and fixing build/lint/test failures',
      task: 'Read the quality gate failure output and make minimal targeted fixes to make the suite pass.',
      context: {
        projectRoot: args.projectRoot,
        qualityOutputPath: args.qualityOutputPath,
        fixOutputFile: path.join(args.iterDir, `quality-fix-attempt-${args.attempt}.json`),
      },
      instructions: [
        `Read the quality gate failure output from: ${args.qualityOutputPath}`,
        'Analyze the errors carefully — understand root cause before changing anything.',
        'Make only the minimal changes needed to fix the failures.',
        'Do NOT refactor, reorganize, or change anything beyond what is required to pass.',
        `Working directory: ${args.projectRoot}`,
        'Do NOT re-run the commands — the next quality gate iteration will verify your fixes.',
        `Write a fix summary to: ${path.join(args.iterDir, `quality-fix-attempt-${args.attempt}.json`)}`,
        'Use this JSON schema:',
        '  {',
        '    "fixedIssues": ["brief description of each fix applied"],',
        '    "modifiedFiles": ["relative/path.ts"],',
        '    "rootCause": "one-line root cause analysis"',
        '  }',
        'Return a result object with: fixedIssues (array), modifiedFiles (array).',
      ],
      outputFormat: 'JSON: { fixedIssues: string[], modifiedFiles: string[] }',
    },
    outputSchema: {
      type: 'object',
      required: ['fixedIssues', 'modifiedFiles'],
      properties: {
        fixedIssues: { type: 'array', items: { type: 'string' } },
        modifiedFiles: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── 6. Commit ───────────────────────────────────────────────────────────────

const commitTask = defineTask('cr-commit', (args, taskCtx) => ({
  kind: 'skill',
  title: `[Iter ${args.iteration}] Commit Changes`,
  skill: {
    name: 'git-commit',
    context: {
      projectRoot: args.projectRoot,
      instructions: [
        `Read the CR findings summary from: ${args.crFindingsPath}`,
        `Read the implementation summary from: ${args.implementationPath}`,
        'Use these to write a commit message that summarizes what was fixed and why.',
        'Follow the git-commit skill conventions exactly.',
        `Stage and commit all changed files in: ${args.projectRoot}`,
        'Do NOT include "Co-Authored-By: Claude" or any AI attribution in the commit message.',
      ],
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));
