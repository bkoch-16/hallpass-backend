/**
 * @process memory-harness/design-review-loop
 * @description Design ↔ Reviewer loop with memory — reviewer findings persist across
 *   iterations via git-memory-harness so the design agent builds on accumulated
 *   critique rather than only the latest round.
 * @inputs { brief: string, maxIterations?: number }
 * @outputs { success: boolean, approved: boolean, iterations: number, artifact: string, reviewHistory: array }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

// ============================================================================
// AGENT TASK DEFINITIONS
// ============================================================================

const agentDesignTask = defineTask('mh-design-agent', async (args, ctx) => {
  return { artifact: args };
}, {
  kind: 'agent',
  title: 'Design Agent',
  labels: ['memory-harness', 'design-review'],
  io: {
    inputs: { brief: 'string', iteration: 'number', priorReviewSummary: 'string' },
    outputs: { artifact: 'string', changesSinceLastIteration: 'string', questionsForReviewer: 'array' }
  }
});

const agentReviewerTask = defineTask('mh-reviewer-agent', async (args, ctx) => {
  return { review: args };
}, {
  kind: 'agent',
  title: 'Reviewer Agent',
  labels: ['memory-harness', 'design-review'],
  io: {
    inputs: { brief: 'string', artifact: 'string', iteration: 'number', reviewHistory: 'array' },
    outputs: { approved: 'boolean', blockingIssues: 'array', suggestions: 'array', assessment: 'string' }
  }
});

// ============================================================================
// MAIN PROCESS
// ============================================================================

/**
 * Design ↔ Reviewer Loop with Memory
 *
 * A design agent produces an artifact; a reviewer critiques it. After each
 * rejected iteration the reviewer stores its findings via:
 *   git-memory-harness remember "blocking: ..." --scope project
 *
 * On the next iteration the design agent recalls accumulated critique:
 *   git-memory-harness recall "blocking issues critique" --scope project
 *
 * This lets the design agent see the full critique history across all prior
 * iterations, not just what the orchestrator passes explicitly.
 *
 * Requires: git-memory-harness installed (`pip install git-memory-harness`)
 *
 * @param {Object} inputs
 * @param {string} inputs.brief         - What to design (spec, requirements, or goal)
 * @param {number} inputs.maxIterations - Max design/review cycles (default: 5)
 * @param {Object} ctx
 */
export async function process(inputs, ctx) {
  const {
    brief,
    maxIterations = 5,
  } = inputs;

  ctx.log('Starting design-review loop', { maxIterations });

  let approved = false;
  let iteration = 0;
  let currentArtifact = '';
  const reviewHistory = [];

  while (!approved && iteration < maxIterations) {
    iteration++;
    ctx.log(`Iteration ${iteration}/${maxIterations}`);

    // ============================================================================
    // DESIGN AGENT
    // Receives the latest review summary via inputs; also instructed to recall
    // full critique history from memory on startup.
    // ============================================================================

    const lastReview = reviewHistory[reviewHistory.length - 1];
    const priorReviewSummary = lastReview
      ? `Last review (iteration ${lastReview.iteration}): ${lastReview.assessment}. Blocking issues: ${(lastReview.blockingIssues || []).join('; ') || 'none'}.`
      : 'No prior review — this is the first iteration.';

    const designResult = await ctx.task(agentDesignTask, {
      brief,
      iteration,
      priorReviewSummary,
      // Instruct design agent to also recall full history from memory
      _instructions: 'Run: git-memory-harness recall "blocking issues critique" --scope project to load the full review history before producing your artifact.',
    });

    currentArtifact = designResult.artifact;
    ctx.log(`Design iteration ${iteration} complete`);

    // ============================================================================
    // REVIEWER AGENT
    // Stores blocking issues to project-scope memory after each rejection so the
    // design agent can recall them on the next iteration.
    // ============================================================================

    const reviewResult = await ctx.task(agentReviewerTask, {
      brief,
      artifact: currentArtifact,
      iteration,
      reviewHistory,
      // Instruct reviewer to persist findings if rejecting
      _instructions: !approved
        ? 'If you find blocking issues, store each one with: git-memory-harness remember "blocking issue: ..." --scope project'
        : undefined,
    });

    reviewHistory.push({
      iteration,
      approved: reviewResult.approved,
      blockingIssues: reviewResult.blockingIssues || [],
      assessment: reviewResult.assessment,
    });

    approved = reviewResult.approved;

    if (approved) {
      ctx.log('Reviewer approved', { iteration });
    } else {
      ctx.log('Reviewer rejected, looping', {
        iteration,
        blockingIssues: reviewResult.blockingIssues,
      });
    }
  }

  if (!approved) {
    await ctx.breakpoint({
      question: `Design-review loop reached max iterations (${maxIterations}) without approval.\n\nLast assessment: ${reviewHistory[reviewHistory.length - 1]?.assessment}\n\nAccept as-is, continue manually, or abort?`,
      title: 'Max Iterations Reached',
      context: { runId: ctx.runId },
    });
  }

  return {
    success: true,
    approved,
    iterations: iteration,
    artifact: currentArtifact,
    reviewHistory,
    metadata: {
      processId: 'memory-harness/design-review-loop',
      timestamp: ctx.now(),
    },
  };
}
