import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const client = new Anthropic();

const filesToIndex = [
  "apps/user-api/src/env.ts",
  "apps/user-api/src/app.ts",
  "apps/user-api/src/auth.ts",
  "apps/user-api/src/middleware/auth.ts",
  "apps/user-api/src/middleware/roleGuard.ts",
  "apps/user-api/src/middleware/validate.ts",
  "apps/user-api/src/schemas/user.ts",
  "apps/user-api/src/routes/user.ts",
  "packages/db/prisma/schema.prisma",
  "packages/auth/src/index.ts",
];

function getBranch(): string {
  // 1. CLI arg: --branch <name>
  const argIdx = process.argv.indexOf("--branch");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }
  // 2. GitHub Actions env var
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  // 3. Current git branch
  return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
}

function getFileContent(filePath: string): string | null {
  const fromRef = process.env.FROM_REF;
  if (fromRef) {
    try {
      return execSync(`git show ${fromRef}:${filePath}`, { encoding: "utf8" });
    } catch {
      console.warn(`Warning: ${filePath} not found in ${fromRef}, skipping`);
      return null;
    }
  }
  // Filesystem fallback (used by index-codebase.yml on direct push)
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Warning: ${filePath} not found, skipping`);
    return null;
  }
  return fs.readFileSync(fullPath, "utf8");
}

function buildFileContents(): string {
  return filesToIndex
    .map((filePath) => {
      const content = getFileContent(filePath);
      if (!content) return null;
      const ext = path.extname(filePath).replace(".", "") || "txt";
      return `### ${filePath}\n\`\`\`${ext}\n${content}\n\`\`\``;
    })
    .filter(Boolean)
    .join("\n\n");
}

const systemPrompt = `You are a codebase analyst. Your job is to produce a structured context document that will be used by an AI code reviewer to give accurate, project-aware feedback on pull requests.

The context document should cover:
- Overall architecture and service responsibilities
- Authentication and authorization patterns
- Route and controller conventions
- Database/migration patterns and conventions
- Error handling patterns
- Key dependencies and why they're used
- Environment variable and config conventions

Be specific and concrete. Prefer examples over descriptions. If you see a pattern used consistently, document it with a short code snippet. Avoid generic statements that would apply to any codebase.`;

async function main() {
  const branch = getBranch();
  fs.mkdirSync("docs", { recursive: true });
  const outputFile = `docs/${branch}-context.md`;

  console.log(`Indexing codebase for branch: ${branch}`);
  console.log(`Output: ${outputFile}`);

  const fileContents = buildFileContents();

  const userPrompt = `Here are the key files from this codebase. Produce a context document following the format above.

${fileContents}`;

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error(`Unexpected response type: ${content.type}`);
  }

  fs.writeFileSync(outputFile, content.text, "utf8");
  console.log(`Written to ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
