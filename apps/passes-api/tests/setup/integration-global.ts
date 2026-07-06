import { execSync } from "child_process";
import { resolve } from "path";

// Requires Docker PostgreSQL to be running:
//   docker-compose up -d
// from the repo root.

export async function setup() {
  execSync("pnpm --filter @hallpass/db exec prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hallpass_test",
    },
    cwd: resolve(__dirname, "../../../.."),
  });
}

export async function teardown() {
  // Individual tests clean up their own data via beforeEach deleteMany.
  // Nothing to do here.
}
