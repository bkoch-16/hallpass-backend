/**
 * @process memory-harness/parallel-feature-agents
 * @description Parallel feature agents with shared memory — each agent owns a domain,
 *   coordinates via git-memory-harness project-scope memory rather than shared state.
 * @inputs { features: array, sharedContext?: string, verifyIntegration?: boolean }
 * @outputs { success: boolean, agentResults: array, integrationResult: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

// ============================================================================
// AGENT TASK DEFINITIONS
// ============================================================================

const agentFeatureTask = defineTask('mh-feature-agent', async (args, ctx) => {
  return { result: args };
}, {
  kind: 'agent',
  title: 'Feature Domain Agent',
  labels: ['memory-harness', 'parallel-agents'],
  skills: ['memory-aware-agent'],
  io: {
    inputs: { feature: 'object', sharedContext: 'string', constraints: 'array' },
    outputs: { summary: 'string', filesChanged: 'array', decisions: 'array', blockers: 'array' }
  }
});

const agentIntegrateTask = defineTask('mh-integrate', async (args, ctx) => {
  return { integration: args };
}, {
  kind: 'agent',
  title: 'Integration Agent',
  labels: ['memory-harness', 'integration'],
  skills: ['memory-aware-agent'],
  io: {
    inputs: { agentResults: 'array', sharedContext: 'string' },
    outputs: { allTestsPass: 'boolean', testOutput: 'string', conflicts: 'array', integrationNotes: 'string' }
  }
});

// ============================================================================
// MAIN PROCESS
// ============================================================================

/**
 * Parallel Feature Agents with Shared Memory
 *
 * Dispatch N agents in parallel, one per feature domain. Agents receive shared
 * context via task inputs and coordinate findings via git-memory-harness
 * project-scope memory (CLI: `git-memory-harness remember "..." --scope project`).
 *
 * Agents use the memory-aware-agent skill, which instructs them to:
 *   - On startup: `git-memory-harness recall "..." --scope project`
 *   - After key decisions: `git-memory-harness remember "..." --scope project`
 *
 * The integration agent reads project-scope memories to surface all agent
 * findings before verifying the combined result.
 *
 * Requires: git-memory-harness installed (`pip install git-memory-harness`)
 *
 * @param {Object} inputs
 * @param {Array}  inputs.features          - Feature domains to work on in parallel
 * @param {string} inputs.sharedContext     - Context all agents need (architecture, constraints, etc.)
 * @param {boolean} inputs.verifyIntegration - Run integration after (default: true)
 * @param {Object} ctx
 */
export async function process(inputs, ctx) {
  const {
    features,
    sharedContext = '',
    verifyIntegration = true,
  } = inputs;

  ctx.log('Starting parallel feature agents', { featureCount: features.length });

  // ============================================================================
  // STEP 1: DISPATCH AGENTS IN PARALLEL
  // Each agent receives sharedContext via inputs and is instructed (via the
  // memory-aware-agent skill) to recall any prior project-scope memories on startup.
  // ============================================================================

  ctx.log('Dispatching agents in parallel', { count: features.length });

  const agentResults = await ctx.parallel.all(
    features.map(feature => {
      const domain = typeof feature === 'string'
        ? { name: feature, description: feature, constraints: [] }
        : feature;
      return ctx.task(agentFeatureTask, {
        feature: domain,
        sharedContext,
        constraints: [
          'Do not modify code outside your feature domain',
          'Store key decisions with: git-memory-harness remember "..." --scope project',
          ...(domain.constraints || []),
        ],
      });
    })
  );

  ctx.log('All agents finished', { count: agentResults.length });

  // ============================================================================
  // STEP 2: INTEGRATE
  // Integration agent reads project-scope memories (via recall on startup) to
  // surface all decisions made during parallel execution.
  // ============================================================================

  let integrationResult = null;

  if (verifyIntegration) {
    ctx.log('Running integration agent');

    integrationResult = await ctx.task(agentIntegrateTask, {
      agentResults,
      sharedContext,
    });

    if (!integrationResult.allTestsPass) {
      await ctx.breakpoint({
        question: `Integration failed after parallel agents finished.\n\nTest output:\n${integrationResult.testOutput}\n\nConflicts:\n${(integrationResult.conflicts || []).join('\n') || 'none'}\n\nFix manually or abort?`,
        title: 'Integration Failure',
        context: { runId: ctx.runId },
      });
    }
  }

  return {
    success: integrationResult ? integrationResult.allTestsPass : true,
    featureCount: features.length,
    agentResults: agentResults.map((r, i) => ({
      feature: (typeof features[i] === 'string' ? features[i] : features[i].name) || `Feature ${i + 1}`,
      summary: r.summary,
      filesChanged: r.filesChanged || [],
      decisions: r.decisions || [],
      blockers: r.blockers || [],
    })),
    integrationResult,
    metadata: {
      processId: 'memory-harness/parallel-feature-agents',
      timestamp: ctx.now(),
    },
  };
}
