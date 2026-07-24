import { PrismaClient, PassStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";

// Non-terminal pass statuses — a pass in one of these states is "in-flight" and
// blocks delete-protection guards (school/destination/period) and the expiry
// reconciler's batch scan. Keep in sync with the PassStatus enum; if a new
// non-terminal state is added, update this list.
//
// IMPORTANT: do NOT add `as const` here. Prisma's generated filter type for
// enum `in` clauses (`EnumPassStatusFilter.in`, see
// node_modules/.prisma/client/index.d.ts) is the mutable `$Enums.PassStatus[]`,
// not a readonly array/tuple. `as const` would produce a readonly tuple type
// that is not assignable to that mutable array parameter (verified: this
// exact mismatch was reproduced with the repo's installed TypeScript compiler
// and fails with error TS4104 — "is 'readonly' and cannot be assigned to the
// mutable type 'PassStatus[]'"). Explicitly annotating the constant as
// `PassStatus[]` keeps it directly assignable at every call site with no
// spread needed.
export const IN_FLIGHT_PASS_STATUSES: PassStatus[] = [
  PassStatus.PENDING,
  PassStatus.WAITING,
  PassStatus.ACTIVE,
];
