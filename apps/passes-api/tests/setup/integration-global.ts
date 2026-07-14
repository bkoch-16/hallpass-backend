import { execSync } from "child_process";
import { resolve } from "path";

import { Client } from "pg";

// Requires Docker PostgreSQL to be running:
//   docker-compose up -d
// from the repo root.

const DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/hallpass_test_passes";
const MAINTENANCE_URL =
  "postgresql://postgres:postgres@localhost:5432/postgres";
const DATABASE_NAME = "hallpass_test_passes";

function ensureDatabaseExists() {
  try {
    execSync(
      `psql "${MAINTENANCE_URL}" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE "${DATABASE_NAME}"'`,
      { stdio: "pipe" },
    );
  } catch (error) {
    // Postgres has no CREATE DATABASE IF NOT EXISTS; ignore duplicate-database
    // (SQLSTATE 42P04) so the setup is invocation-independent.
    const message = String((error as { stderr?: Buffer }).stderr ?? error);
    if (!message.includes("42P04") && !message.includes("already exists")) {
      throw error;
    }
  }
}

export async function setup() {
  ensureDatabaseExists();
  execSync("pnpm --filter @hallpass/db exec prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL,
    },
    cwd: resolve(__dirname, "../../../.."),
  });

  // The `one_active_pass_per_student` partial unique index lives only in a
  // migration (never in schema.prisma), so a stray `prisma migrate dev` can
  // silently drop it. Without it, passes-api's 409 duplicate-pass contract
  // degrades to allowing multiple active passes. Fail loudly if it is missing.
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'Pass' AND indexname = 'one_active_pass_per_student'",
    );
    if (rows.length === 0) {
      throw new Error(
        'Missing partial unique index "one_active_pass_per_student" on the "Pass" table. ' +
          "A migration likely dropped it — passes-api's 409 duplicate-pass contract will silently break.",
      );
    }
  } finally {
    await client.end();
  }
}

export async function teardown() {
  // Individual tests clean up their own data via beforeEach deleteMany.
  // Nothing to do here.
}
