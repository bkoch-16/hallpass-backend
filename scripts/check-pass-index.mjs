#!/usr/bin/env node
// Guards the `one_active_pass_per_student` partial unique index.
//
// The index exists ONLY in a migration (it is intentionally absent from
// schema.prisma), so `prisma migrate dev` regenerates a `DROP INDEX` that a
// human must delete before committing. passes-api relies on the index: a
// Prisma P2002 on Pass create becomes the 409 "Active pass already exists"
// contract. If the index is dropped, a student could silently hold two active
// passes. This script fails CI if a migration drops the index, or if no
// migration ever creates it.

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const INDEX_NAME = "one_active_pass_per_student";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../packages/db/prisma/migrations");

function collectSqlFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSqlFiles(full));
    } else if (entry.endsWith(".sql")) {
      files.push(full);
    }
  }
  return files;
}

// Strip SQL line comments (lines starting with `--`, ignoring leading whitespace).
function stripComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const dropRe = new RegExp(`DROP\\s+INDEX\\b[^;]*"?${INDEX_NAME}"?`, "i");
const createRe = new RegExp(
  `CREATE\\b[^;]*INDEX\\b[^;]*"?${INDEX_NAME}"?`,
  "i",
);

const sqlFiles = collectSqlFiles(migrationsDir);

let createdSomewhere = false;
const droppedIn = [];

for (const file of sqlFiles) {
  const sql = stripComments(readFileSync(file, "utf8"));
  if (dropRe.test(sql)) {
    droppedIn.push(file);
  }
  if (createRe.test(sql)) {
    createdSomewhere = true;
  }
}

let failed = false;

if (droppedIn.length > 0) {
  failed = true;
  console.error(
    `ERROR: migration(s) drop the "${INDEX_NAME}" index:\n` +
      droppedIn.map((f) => `  - ${f}`).join("\n") +
      "\nRemove the DROP INDEX statement (see schema.prisma WARNING above `model Pass`).",
  );
}

if (!createdSomewhere) {
  failed = true;
  console.error(
    `ERROR: no migration creates the "${INDEX_NAME}" index. ` +
      "passes-api's 409 duplicate-pass contract depends on it.",
  );
}

if (failed) {
  process.exit(1);
}

console.log(
  `OK: "${INDEX_NAME}" index is created and never dropped across migrations.`,
);
