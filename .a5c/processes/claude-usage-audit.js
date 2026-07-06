/**
 * @process claude-usage-audit
 * @description Audit the user's Claude Code usage from ~/.claude/projects session
 * transcripts and produce a direct, critical claude-code-audit.md report.
 *
 * Report contract (from the user's request — the quality gate scores against this):
 *   1. Usage overview — sessions, projects, time span, typical session length
 *   2. Top 3 strengths, with concrete examples quoted from transcripts
 *   3. Top 3 growth areas, each with evidence and a specific habit change
 *   4. 5 real prompts rewritten to be more effective, shown before/after
 *   5. Underused features and where they would have helped
 *   6. Recurring correction patterns — what context is consistently left out
 *   Tone: direct and critical, not encouraging. Quote actual prompts.
 *
 * Data profile (measured 2026-07-02): 13 project dirs, ~142 sessions, 155MB total;
 * largest project is 52MB / 41 sessions — per-project agents MUST sample/grep,
 * never read whole transcripts into context.
 *
 * Phases (quota-trimmed per user choice on 2026-07-02):
 *   1 — Inventory (shell): enumerate projects/sessions, date ranges, sizes, message counts
 *   2 — Analysis: one agent per LARGE project (>10 sessions); all small projects
 *       batched into a single agent (~6 tasks instead of ~11). Waves of 4, largest
 *       first; each appends interim findings to claude-code-audit.md so nothing is lost
 *   3 — Synthesis (agent): cross-project final report replacing the interim file
 *   4 — Quality gate (max 2 iterations = score, one refine, rescore): scorer verifies
 *       section contract + that quoted prompts actually exist in the transcripts
 *       (grep), refiner fixes gaps
 *   5 — Breakpoint: human review of the final report
 *
 * Privacy: transcripts are private. All tasks work locally only — no WebSearch,
 * no WebFetch, no sending transcript content to any external service.
 *
 * Profile: moderate breakpoint tolerance — single final review breakpoint,
 * matching the pattern in fix-code-review-issues.js. Only the built-in
 * general-purpose agent is used; no library skills apply to transcript auditing.
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs = {}, ctx) {
  const projectsDir = inputs.projectsDir ?? '/Users/bkoch/.claude/projects';
  const outputFile =
    inputs.outputFile ?? '/Users/bkoch/development/hallpass-backend/claude-code-audit.md';
  const QUALITY_THRESHOLD = inputs.qualityThreshold ?? 85;
  const MAX_REFINE_ITERATIONS = inputs.maxRefineIterations ?? 2;
  const WAVE_SIZE = 4;
  const SMALL_PROJECT_MAX_SESSIONS = inputs.smallProjectMaxSessions ?? 10;

  // ============================================================================
  // PHASE 1 — Inventory (deterministic shell task)
  // ============================================================================

  ctx.log('info', 'Phase 1: Inventorying session transcripts');

  const inventory = await ctx.task(inventoryTask, { projectsDir, outputFile });
  const projects = (inventory.projects ?? []).filter((p) => p.sessionCount > 0);

  if (projects.length === 0) {
    throw new Error(`No session transcripts found under ${projectsDir}`);
  }

  // ============================================================================
  // PHASE 2 — Analysis in parallel waves (largest projects first, so the
  // slowest work starts immediately). Large projects get their own agent;
  // all small projects share one agent to avoid per-invocation overhead.
  // ============================================================================

  const sorted = [...projects].sort((a, b) => b.sizeKb - a.sizeKb);
  const large = sorted.filter((p) => p.sessionCount > SMALL_PROJECT_MAX_SESSIONS);
  const small = sorted.filter((p) => p.sessionCount <= SMALL_PROJECT_MAX_SESSIONS);

  const analysisUnits = large.map((p) => [p]);
  if (small.length > 0) analysisUnits.push(small);

  ctx.log(
    'info',
    `Phase 2: ${large.length} large projects individually + ${small.length} small batched — ${analysisUnits.length} tasks in waves of ${WAVE_SIZE}`,
  );

  const findings = [];

  for (let i = 0; i < analysisUnits.length; i += WAVE_SIZE) {
    const wave = analysisUnits.slice(i, i + WAVE_SIZE);
    const results = await ctx.parallel.all(
      wave.map((unit) => () =>
        ctx.task(analyzeProjectsTask, { projects: unit, projectsDir, outputFile }),
      ),
    );
    for (const r of results) findings.push(...(r.projectFindings ?? []));
  }

  // ============================================================================
  // PHASE 3 — Cross-project synthesis into the final report
  // ============================================================================

  ctx.log('info', 'Phase 3: Synthesizing final audit report');

  await ctx.task(synthesizeReportTask, { inventory, findings, outputFile, projectsDir });

  // ============================================================================
  // PHASE 4 — Quality gate convergence loop (max 3 iterations)
  // ============================================================================

  let iteration = 0;
  let score = 0;
  let gaps = [];

  while (iteration < MAX_REFINE_ITERATIONS) {
    iteration++;

    const review = await ctx.task(scoreReportTask, {
      outputFile,
      projectsDir,
      inventorySummary: inventory.projects,
      attempt: iteration,
    });

    score = review.score ?? 0;
    gaps = review.gaps ?? [];

    if (score >= QUALITY_THRESHOLD) break;

    if (iteration < MAX_REFINE_ITERATIONS) {
      ctx.log('warn', `Report scored ${score} (< ${QUALITY_THRESHOLD}) — refining`);
      await ctx.task(refineReportTask, { outputFile, projectsDir, gaps, score, iteration });
    }
  }

  // ============================================================================
  // PHASE 5 — Breakpoint: human review of the final report
  // ============================================================================

  const passed = score >= QUALITY_THRESHOLD;

  await ctx.breakpoint({
    question: [
      passed
        ? `Audit report complete — quality score ${score}/100 (${iteration === 1 ? 'first pass' : `after ${iteration - 1} refinement(s)`}).`
        : `Audit report scored ${score}/100 after ${MAX_REFINE_ITERATIONS} attempts. Remaining gaps:\n${gaps.map((g) => `  • ${g}`).join('\n')}`,
      '',
      `Report: ${outputFile}`,
      `Projects analyzed: ${projects.length} (${projects.reduce((n, p) => n + p.sessionCount, 0)} sessions)`,
      '',
      'Approve to mark the audit complete, or reject with feedback to revise.',
    ].join('\n'),
    title: passed ? 'Review Claude Code Usage Audit' : 'Audit Below Quality Bar — Review Required',
    context: { runId: ctx.runId },
  });

  return { success: passed, score, projectsAnalyzed: projects.length };
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

// ─── Phase 1: Inventory ──────────────────────────────────────────────────────

const inventoryTask = defineTask('inventory-transcripts', (args) => ({
  kind: 'shell',
  title: 'Inventory session transcripts (counts, sizes, date ranges)',
  command: [
    `printf '# Claude Code Usage Audit\\n\\n_In progress — interim findings below are replaced by the final report._\\n' > "${args.outputFile}"`,
    `for d in "${args.projectsDir}"/*/; do
      name=$(basename "$d")
      c=$(find "$d" -maxdepth 1 -name "*.jsonl" | wc -l | tr -d ' ')
      sz=$(du -sk "$d" 2>/dev/null | cut -f1)
      first=""; last=""; um=0
      if [ "$c" -gt 0 ]; then
        first=$(for f in "$d"*.jsonl; do grep -m1 -o '"timestamp":"[^"]*"' "$f" | cut -d'"' -f4; done | sort | head -1)
        last=$(for f in "$d"*.jsonl; do tail -c 20000 "$f" | grep -o '"timestamp":"[^"]*"' | tail -1 | cut -d'"' -f4; done | sort | tail -1)
        um=$(cat "$d"*.jsonl 2>/dev/null | grep -c '"type":"user"' || true)
      fi
      jq -n --arg name "$name" --argjson sessionCount "$c" --argjson sizeKb "\${sz:-0}" \\
        --arg firstTimestamp "$first" --arg lastTimestamp "$last" --argjson userMessages "\${um:-0}" \\
        '{name: $name, sessionCount: $sessionCount, sizeKb: $sizeKb, firstTimestamp: $firstTimestamp, lastTimestamp: $lastTimestamp, userMessages: $userMessages}'
    done | jq -s '{projects: .}'`,
  ].join(' && '),
  cwd: '/Users/bkoch/development/hallpass-backend',
  timeout: 180000,
  outputSchema: {
    type: 'object',
    required: ['projects'],
    properties: {
      projects: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'sessionCount', 'sizeKb'],
          properties: {
            name: { type: 'string' },
            sessionCount: { type: 'number' },
            sizeKb: { type: 'number' },
            firstTimestamp: { type: 'string' },
            lastTimestamp: { type: 'string' },
            userMessages: { type: 'number' },
          },
        },
      },
    },
  },
  transform: (stdout) => JSON.parse(stdout.slice(stdout.indexOf('{'))),
}));

// ─── Phase 2: Transcript analysis (one large project, or a batch of small ones) ──

const analyzeProjectsTask = defineTask('analyze-projects', (args, taskCtx) => ({
  kind: 'agent',
  title:
    args.projects.length === 1
      ? `Analyze transcripts — ${args.projects[0].name} (${args.projects[0].sessionCount} sessions, ${Math.round(args.projects[0].sizeKb / 1024)}MB)`
      : `Analyze transcripts — ${args.projects.length} small projects (${args.projects.reduce((n, p) => n + p.sessionCount, 0)} sessions total)`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Prompt-engineering coach auditing Claude Code session transcripts to give the user honest, critical feedback on how they prompt',
      task: `Analyze every session in each listed project directory under ${args.projectsDir}/ and extract the user's prompting patterns, correction events, and feature usage. Append interim findings to the audit file, and return structured JSON with one findings object per project.`,
      context: {
        transcriptDirs: args.projects.map((p) => `${args.projectsDir}/${p.name}`),
        auditFile: args.outputFile,
        projects: args.projects,
        privacy:
          'Transcripts are private. Work locally only. Do NOT use WebSearch or WebFetch, and do not send transcript content to any external service.',
        jsonlFormat: [
          'One JSON object per line. User turns have "type":"user". Real user prompts have message.content as a string, or an array containing {"type":"text"} items.',
          'EXCLUDE: entries whose content is only tool_result items (tool outputs, not the user typing), and entries with "isMeta":true.',
          'Slash commands appear as <command-name>/foo</command-name> wrappers in user messages — record which commands, but do not treat the wrapper text as a hand-typed prompt.',
        ],
        samplingRules: [
          'NEVER read a whole .jsonl file into context — the largest are >5MB.',
          'Use grep/jq pipelines to pull out just user text, e.g.: cat <file> | jq -r \'select(.type=="user") | .message.content | if type=="string" then . elif type=="array" then (map(select(.type=="text") | .text) | join(" ")) else empty end\' 2>/dev/null | head -80',
          'For every session: extract the OPENING prompt verbatim and the first ~10 subsequent user messages.',
          'grep -c for correction phrases across each full file is cheap — do that on every session.',
        ],
        correctionPhrases: [
          '"no,"', '"no."', 'actually', 'instead', 'undo', 'revert',
          "that's not what I meant", 'wrong', "don't", 'stop', 'wait',
          'I meant', 'not that',
        ],
        featureMarkers: {
          planMode: 'ExitPlanMode / "plan mode" / plan file mentions',
          slashCommands: '<command-name> wrappers',
          subagents: '"Task" tool invocations / subagent_type',
          hooks: '"hook" / UserPromptSubmit / stop-hook mentions',
          mcpTools: 'tool names starting with mcp__',
          claudeMd: 'CLAUDE.md appearing in context blocks',
        },
      },
      instructions: [
        '1. For each project directory in transcriptDirs: list the .jsonl session files and their sizes.',
        '2. For each session: extract the opening user prompt verbatim; judge whether it succeeded as-is or required follow-up correction (look at the next few user messages — corrections, restatements, "no/actually/instead" turns).',
        '3. grep each session for the correction phrases; for each real correction (not a false positive like "no tests exist"), capture the verbatim user quote, the session filename, and infer WHAT CONTEXT WAS MISSING from the original prompt that made the correction necessary.',
        '4. Detect feature usage per the featureMarkers (plan mode, slash commands, subagents, hooks, MCP tools, CLAUDE.md).',
        '5. Per project, select 3–8 notable prompts (verbatim): the best-crafted, the vaguest, and any that triggered multi-turn correction spirals. For tiny projects (1-2 sessions) 1-3 quotes suffice.',
        '6. APPEND (do not overwrite) one interim section per project to the audit file: "## Interim — <project name>" with session count, first-prompt success estimate, correction stats, features used, and the notable quotes. This protects findings from context compaction.',
        '7. Be critical, not generous: a prompt that "worked" after three clarifying rounds counts as a first-prompt failure.',
        '8. Return ONLY the summary JSON in the requested schema — one entry in projectFindings per project analyzed.',
      ],
      outputFormat:
        'JSON with projectFindings: array of {projectName, sessionsAnalyzed, totalUserPrompts, firstPromptSuccessRate (0-1 estimate), correctionCount, correctionExamples (array of {quote, sessionFile, missingContext}), notablePrompts (array of {quote, sessionFile, assessment}), featuresUsed (object of feature -> count/boolean), observations (string[])}',
      outputSchema: {
        type: 'object',
        required: ['projectFindings'],
        properties: {
          projectFindings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['projectName', 'sessionsAnalyzed', 'observations'],
              properties: {
                projectName: { type: 'string' },
                sessionsAnalyzed: { type: 'number' },
                totalUserPrompts: { type: 'number' },
                firstPromptSuccessRate: { type: 'number' },
                correctionCount: { type: 'number' },
                correctionExamples: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      quote: { type: 'string' },
                      sessionFile: { type: 'string' },
                      missingContext: { type: 'string' },
                    },
                  },
                },
                notablePrompts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      quote: { type: 'string' },
                      sessionFile: { type: 'string' },
                      assessment: { type: 'string' },
                    },
                  },
                },
                featuresUsed: { type: 'object' },
                observations: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 3: Synthesis ──────────────────────────────────────────────────────

const synthesizeReportTask = defineTask('synthesize-report', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Synthesize final audit report from per-project findings',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior engineering coach writing a blunt, evidence-based audit of how this user works with Claude Code',
      task: `Replace the contents of ${args.outputFile} with the final audit report, synthesized from the per-project findings JSON and the interim sections already in the file.`,
      context: {
        auditFile: args.outputFile,
        transcriptsRoot: args.projectsDir,
        inventory: args.inventory,
        findings: args.findings,
        privacy: 'Local only — no WebSearch/WebFetch, no external services.',
        requiredSections: [
          '1. Usage overview: sessions, projects, time span, typical session length (derive from inventory timestamps and message counts)',
          '2. Top 3 strengths, each with concrete quoted examples from the transcripts',
          '3. Top 3 growth areas, each with evidence (quotes/counts) AND a specific habit change',
          '4. Exactly 5 real prompts rewritten to be more effective, shown before/after — the "before" must be a verbatim quote',
          '5. Underused features (plan mode, CLAUDE.md, slash commands, subagents, hooks, MCP) and specific sessions where they would have helped',
          '6. Recurring correction patterns: what context the user consistently leaves out of first prompts',
        ],
        tone: 'Direct and critical. The user explicitly asked for honest feedback, not encouragement. No praise padding, no hedging.',
      },
      instructions: [
        '1. Read the interim sections in the audit file and the findings JSON from input.json.',
        '2. Cross-reference patterns that repeat across projects — those are the real habits; single-project quirks are secondary.',
        '3. Before quoting any prompt, verify it exists verbatim: grep -rF a distinctive substring of the quote in the transcripts root. Never fabricate or paraphrase-as-quote.',
        '4. For the 5 before/after rewrites, pick prompts that actually caused correction spirals or vague first attempts — rewrite each to include the context that was later supplied in corrections.',
        '5. Write the full report to the audit file, REPLACING the interim content. Keep a short "Appendix: per-project notes" section at the bottom summarizing each project in 1-2 lines.',
        '6. Every claim must trace to evidence — a quote, a count, or a named session file.',
        '7. Return the summary JSON only.',
      ],
      outputFormat:
        'JSON with success (boolean), sectionsWritten (string[]), quotesVerified (number), reportPath (string)',
      outputSchema: {
        type: 'object',
        required: ['success', 'sectionsWritten'],
        properties: {
          success: { type: 'boolean' },
          sectionsWritten: { type: 'array', items: { type: 'string' } },
          quotesVerified: { type: 'number' },
          reportPath: { type: 'string' },
        },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 4a: Quality gate scorer ───────────────────────────────────────────

const scoreReportTask = defineTask('score-report', (args, taskCtx) => ({
  kind: 'agent',
  title: `Score audit report against the request contract (attempt ${args.attempt})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Skeptical reviewer verifying an audit report against the original request, with shell access to verify quotes against source transcripts',
      task: `Score ${args.outputFile} from 0-100 against the checklist. Verify quotes are real. List every gap.`,
      context: {
        auditFile: args.outputFile,
        transcriptsRoot: args.projectsDir,
        inventorySummary: args.inventorySummary,
        checklist: [
          'All 6 required sections present: usage overview / top 3 strengths / top 3 growth areas / 5 before-after prompt rewrites / underused features / recurring correction patterns (30 pts)',
          'Overview numbers consistent with the inventory summary provided (10 pts)',
          'Exactly 5 before/after rewrites, each "before" verified verbatim in transcripts via grep -rF (20 pts)',
          'Each strength and growth area cites concrete quoted evidence; each growth area names a specific habit change (20 pts)',
          'Tone is direct and critical — flag praise padding, hedging, or generic advice not tied to evidence (10 pts)',
          'Underused-features section names specific sessions/situations where the feature would have helped (10 pts)',
        ],
      },
      instructions: [
        '1. Read the audit report in full.',
        '2. Score each checklist item; sum to 0-100.',
        '3. Spot-check at least 5 quoted prompts: grep -rF a distinctive substring in the transcripts root. Any fabricated quote caps the total score at 50.',
        '4. List each gap as a specific, actionable string (what is missing and where).',
        '5. Return the summary JSON only.',
      ],
      outputFormat: 'JSON with score (number 0-100), gaps (string[]), quotesChecked (number), quotesVerified (number)',
      outputSchema: {
        type: 'object',
        required: ['score', 'gaps'],
        properties: {
          score: { type: 'number' },
          gaps: { type: 'array', items: { type: 'string' } },
          quotesChecked: { type: 'number' },
          quotesVerified: { type: 'number' },
        },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

// ─── Phase 4b: Refinement ────────────────────────────────────────────────────

const refineReportTask = defineTask('refine-report', (args, taskCtx) => ({
  kind: 'agent',
  title: `Fix audit report gaps (iteration ${args.iteration}, score ${args.score})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Engineering coach revising an audit report to close specific reviewer gaps',
      task: `Fix only the listed gaps in ${args.outputFile}. Do not rewrite sections the reviewer did not flag.`,
      context: {
        auditFile: args.outputFile,
        transcriptsRoot: args.projectsDir,
        gaps: args.gaps,
        currentScore: args.score,
        privacy: 'Local only — no WebSearch/WebFetch, no external services.',
      },
      instructions: [
        '1. Read the audit report and the gap list.',
        '2. For each gap, gather any missing evidence directly from the transcripts (grep/jq — never read whole large files).',
        '3. Any quote you add must be verified verbatim via grep -rF before inclusion.',
        '4. Edit the report surgically — fix flagged gaps only.',
        '5. Return the summary JSON only.',
      ],
      outputFormat: 'JSON with gapsFixed (string[]), gapsRemaining (string[])',
      outputSchema: {
        type: 'object',
        required: ['gapsFixed'],
        properties: {
          gapsFixed: { type: 'array', items: { type: 'string' } },
          gapsRemaining: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));
