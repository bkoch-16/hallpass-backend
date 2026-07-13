import { execSync } from "child_process";
import { resolve } from "path";

import { prisma } from "@hallpass/db";

// Requires Docker PostgreSQL to be running:
//   docker-compose up -d
// from the repo root.

export async function setup() {
  execSync("pnpm --filter @hallpass/db exec prisma migrate deploy", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL:
        "postgresql://postgres:postgres@localhost:5432/hallpass_test",
    },
    cwd: resolve(__dirname, "../../../.."),
  });

  // The `one_active_pass_per_student` partial unique index lives only in a
  // migration (never in schema.prisma), so a stray `prisma migrate dev` can
  // silently drop it. Without it, passes-api's 409 duplicate-pass contract
  // degrades to allowing multiple active passes. Fail loudly if it is missing.
  const rows = await prisma.$queryRaw<
    { indexname: string }[]
  >`SELECT indexname FROM pg_indexes WHERE tablename = 'Pass' AND indexname = 'one_active_pass_per_student'`;
  if (rows.length === 0) {
    throw new Error(
      'Missing partial unique index "one_active_pass_per_student" on the "Pass" table. ' +
        "A migration likely dropped it — passes-api's 409 duplicate-pass contract will silently break.",
    );
  }
}

export async function teardown() {
  // Individual tests clean up their own data via beforeEach deleteMany.
  // Nothing to do here.
}
