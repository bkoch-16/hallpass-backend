import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic();

const systemPrompt = `You are an expert code reviewer with full knowledge of this codebase. Review the diff against the project conventions documented in the context file provided.

Flag real issues only — do not nitpick style or formatting that Prettier and ESLint already enforce. Do not flag compile errors or type errors — those are caught by the pre-push hook before code reaches review.

Before flagging a security issue, scan the full diff for existing guards, conditions, or restrictions that already mitigate it. If a mitigation exists, acknowledge it and adjust your severity accordingly. When flagging an ordering issue (e.g., "X is called before validation"), trace the actual execution sequence in the surrounding function to confirm the order — do not infer it from relative line proximity alone.

Before flagging any expression as a bug, trace it to its final value — show each intermediate result for chained calls (e.g., a.slice().replace() must be evaluated as two steps, not one). If the code needed to complete the trace is not present in the diff or context file, do not label it a "Confirmed bug" — label it "Needs human verification" and state exactly what additional context is required.

Each issue must carry one of these confidence labels:
- **Confirmed bug** — fully traced end-to-end, behavior verified as wrong from the diff alone
- **Likely bug** — strong evidence but trace is incomplete due to missing context; flag for human review
- **Nitpick / design concern** — not a correctness issue

Only issues labeled "Confirmed bug" should drive a "Request changes" verdict.

Before flagging a missing or undeclared dependency, check whether \`package.json\` appears in the codebase context. If it does, verify the dependency is listed there before raising an issue. If \`package.json\` is not available in the context or diff, move the concern to **Unverified Claims** — not Issues.

For every issue you raise, reference the specific file and line number(s) from the diff.

Structure your review as:
## Summary
Brief description of what the PR changes.

## Issues
List any bugs, security concerns, or convention violations. If none, say "None found." Do not include anything that belongs in Unverified Claims — if you cannot verify a claim from the diff or context file, it goes in Unverified Claims, not Issues.

## Unverified Claims
List any observations that depend on knowledge of external APIs, library versions, or third-party identifiers (e.g., model names, package versions, API behavior) that cannot be confirmed from the diff or context file alone. Do not include claims about code, flags, or behavior that is directly visible in the diff. These are flagged for human review and do not affect the verdict.

## Verdict
Start the line with either "Ship it" or "Request changes" (no prefix, no emoji), followed by " — " and one sentence explaining why. Example: "Ship it — no issues found."

Do not use the phrases "Ship it" or "Request changes" anywhere else in your response.`;

async function main() {
  const contextFile = process.env.CONTEXT_FILE;
  const diffFile = process.env.DIFF_FILE;

  if (!diffFile || !fs.existsSync(diffFile)) {
    process.stdout.write("No diff file found — nothing to review.\n");
    return;
  }

  const diff = fs.readFileSync(diffFile, "utf8").trim();
  if (!diff) {
    process.stdout.write("No code changes detected — nothing to review.\n");
    return;
  }

  let contextSection = "";
  if (contextFile && fs.existsSync(contextFile)) {
    const context = fs.readFileSync(contextFile, "utf8").trim();
    if (context) {
      contextSection = `## Codebase Context\n\n${context}\n\n---\n\n`;
    }
  } else {
    contextSection =
      "## Codebase Context\n\n_Context file not yet available (indexing runs after first merge)._\n\n---\n\n";
  }

  const userPrompt = `${contextSection}## PR Diff\n\n~~~diff\n${diff}\n~~~\n\nPlease review this diff.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error(`Unexpected response type: ${content.type}`);
  }

  process.stdout.write(`<!-- ai-review -->\n${content.text}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
