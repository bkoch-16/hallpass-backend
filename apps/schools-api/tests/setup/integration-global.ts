import { execSync } from "child_process";
import { resolve } from "path";

// Requires Docker PostgreSQL to be running:
//   docker-compose up -d
// from the repo root.

const DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/hallpass_test_schools";
const MAINTENANCE_URL =
  "postgresql://postgres:postgres@localhost:5432/postgres";
const DATABASE_NAME = "hallpass_test_schools";

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
}

export async function teardown() {
  // Individual tests clean up their own data via beforeEach deleteMany.
  // Nothing to do here.
}
