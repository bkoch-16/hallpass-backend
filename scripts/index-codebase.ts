import Anthropic from "@anthropic-ai/sdk";
import fg from "fast-glob";
import micromatch from "micromatch";
import fs from "fs";
import path from "path";
import { execSync, execFileSync } from "child_process";

const client = new Anthropic();

// Glob patterns for file discovery (relative to repo root)
const globPatterns = [
  "package.json",
  "apps/user-api/src/**/*.ts",
  "packages/db/prisma/schema.prisma",
  "packages/auth/src/**/*.ts",
  "apps/user-api/Dockerfile",
  "docker-compose.yml",
  ".github/workflows/*.yml",
];

// Derived automatically from globPatterns — do not edit manually.
// Covers the root directories git ls-tree needs to find all matching files.
const globDirs = [
  ...new Set(
    globPatterns.map((p) => {
      const globIdx = p.search(/[*?[]/);
      const prefix = globIdx === -1 ? p : p.slice(0, globIdx);
      return prefix.replace(/[^/]*$/, "") || ".";
    })
  ),];

// Max files per Claude batch (to stay within token limits)
const BATCH_SIZE = 10;

interface FileEntry {
  blobSha: string;
  summary: string;
}

interface Manifest {
  version: number;
  generatedAt: string;
  files: Record<string, FileEntry>;
}

function getBranch(): string {
  const argIdx = process.argv.indexOf("--branch");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
}

function getFileContent(filePath: string): string | null {
  const fromRef = process.env.FROM_REF;
  if (fromRef) {
    try {
      return execFileSync("git", ["show", `${fromRef}:${filePath}`], { encoding: "utf8" });
    } catch {
      console.warn(`Warning: ${filePath} not found in ${fromRef}, skipping`);
      return null;
    }
  }
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Warning: ${filePath} not found, skipping`);
    return null;
  }
  return fs.readFileSync(fullPath, "utf8");
}

function discoverFiles(fromRef?: string): string[] {
  if (fromRef) {
    const result = execFileSync(
      "git",
      ["ls-tree", "--name-only", "-r", fromRef, "--", ...globDirs],
      { encoding: "utf8" }
    ).trim();
    const allFiles = result ? result.split("\n") : [];
    return micromatch(allFiles, globPatterns);
  }
  return fg.sync(globPatterns);
}

function getBlobSha(filePath: string, fromRef?: string): string | null {
  if (fromRef) {
    const output = execFileSync("git", ["ls-tree", fromRef, "--", filePath], {
      encoding: "utf8",
    }).trim();
    if (!output) return null;
    // Format: "100644 blob <sha> <path>"
    return output.split(/\s+/)[2] ?? null;
  }
  try {
    return execFileSync("git", ["hash-object", filePath], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function loadManifest(branch: string): Manifest {
  const manifestFile = `docs/${branch}-manifest.json`;
  if (!fs.existsSync(manifestFile)) {
    return { version: 1, generatedAt: new Date().toISOString(), files: {} };
  }
  return JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Manifest;
}

function saveManifest(branch: string, manifest: Manifest): void {
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(
    `docs/${branch}-manifest.json`,
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

function buildContextDoc(manifest: Manifest, branch: string): string {
  const fileCount = Object.keys(manifest.files).length;
  const lines = [
    `# Codebase Context — ${branch}`,
    ``,
    `_Generated: ${manifest.generatedAt} — ${fileCount} files indexed_`,
    ``,
    `## File Summaries`,
    ``,
  ];
  for (const [filePath, entry] of Object.entries(manifest.files).sort()) {
    lines.push(`### \`${filePath}\``);
    lines.push(``);
    lines.push(entry.summary);
    lines.push(``);
  }
  return lines.join("\n");
}

const perFileSummaryPrompt = `For each file below, write a concise technical summary (3-6 sentences) covering:
- Purpose and responsibility of the file
- Key exports, functions, types, or classes
- Important patterns, conventions, or dependencies used
- Anything a developer needs to know when modifying this file

Return a JSON object where each key is the exact file path and the value is the summary string.
Wrap the JSON in <json> and </json> tags. Do not include any other content outside the tags.`;

async function summarizeFiles(
  files: string[]
): Promise<Record<string, string>> {
  const fileContents = files
    .map((filePath) => {
      const content = getFileContent(filePath);
      if (!content) return null;
      const ext = path.extname(filePath).replace(".", "") || "txt";
      return `### ${filePath}\n\`\`\`${ext}\n${content}\n\`\`\``;
    })
    .filter(Boolean)
    .join("\n\n");

  if (!fileContents) return {};

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${perFileSummaryPrompt}\n\n${fileContents}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error(`Unexpected response type: ${content.type}`);
  }
  const raw = content.text;
  const start = raw.indexOf("<json>");
  const end = raw.indexOf("</json>");
  if (start === -1 || end === -1) {
    throw new Error(`No <json> block found in response: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start + 6, end).trim()) as Record<string, string>;
}

async function main() {
  const branch = getBranch();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch)) {
    throw new Error(`Invalid branch name for filesystem use: ${branch}`);
  }
  const branchSlug = branch.replace(/\//g, "-");
  const fromRef = process.env.FROM_REF;
  if (fromRef !== undefined && !/^[a-zA-Z0-9/_.-]+$/.test(fromRef)) {
    throw new Error(`Invalid FROM_REF: ${fromRef}`);
  }

  fs.mkdirSync("docs", { recursive: true });

  const allFiles = discoverFiles(fromRef);
  console.log(`Discovered ${allFiles.length} files matching glob patterns`);

  const manifest = loadManifest(branchSlug);

  // Per-file delta detection using blob SHAs — capture once, reuse later
  const changedWithSha = new Map<string, string>(); // file -> blobSha
  const deleted: string[] = [];

  for (const file of allFiles) {
    const currentSha = getBlobSha(file, fromRef);
    if (currentSha && manifest.files[file]?.blobSha !== currentSha) {
      changedWithSha.set(file, currentSha);
    }
  }

  const fileSet = new Set(allFiles);
  for (const file of Object.keys(manifest.files)) {
    if (!fileSet.has(file)) deleted.push(file);
  }

  if (changedWithSha.size === 0 && deleted.length === 0) {
    console.log(
      `No changes to indexed files — skipping. (${allFiles.length} files up to date)`
    );
    return;
  }

  console.log(
    `Changes detected: ${changedWithSha.size} changed/new, ${deleted.length} deleted`
  );

  // Remove deleted files from manifest
  for (const file of deleted) {
    delete manifest.files[file];
    console.log(`  Removed: ${file}`);
  }

  // Process changed files in batches
  const changedFiles = [...changedWithSha.keys()];
  for (let i = 0; i < changedFiles.length; i += BATCH_SIZE) {
    const batch = changedFiles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(changedFiles.length / BATCH_SIZE);
    console.log(
      `Indexing batch ${batchNum}/${totalBatches}: ${batch.length} files`
    );

    const summaries = await summarizeFiles(batch);

    for (const file of batch) {
      const summary = summaries[file];
      if (!summary) {
        console.warn(`Warning: no summary returned for ${file} — will retry on next run`);
        continue;
      }
      manifest.files[file] = {
        blobSha: changedWithSha.get(file)!,
        summary,
      };
    }

    saveManifest(branchSlug, manifest);
  }

  const contextDoc = buildContextDoc(manifest, branch);
  const outputFile = `docs/${branchSlug}-context.md`;
  fs.writeFileSync(outputFile, contextDoc, "utf8");

  console.log(
    `Written ${Object.keys(manifest.files).length} file summaries to ${outputFile}`
  );
  console.log(`Manifest saved to docs/${branchSlug}-manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
