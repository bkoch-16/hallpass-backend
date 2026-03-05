import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Must match better-auth's password hashing config exactly (dist/crypto/password.mjs)
async function hashPassword(password: string): Promise<string> {
  const salt = bytesToHex(randomBytes(16));
  const key = await scryptAsync(password.normalize("NFKC"), salt, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
    maxmem: 128 * 16384 * 16 * 2,
  });
  return `${salt}:${bytesToHex(key)}`;
}

const seedUsers = [
  { email: "student@hallpass.dev", name: "Sample Student", role: "STUDENT" as const },
  { email: "teacher@hallpass.dev", name: "Sample Teacher", role: "TEACHER" as const },
  { email: "admin@hallpass.dev", name: "Sample Admin", role: "ADMIN" as const },
  { email: "superadmin@hallpass.dev", name: "Sample Super Admin", role: "SUPER_ADMIN" as const },
];

const DEFAULT_PASSWORD = "password";

async function main() {
  const hashedPassword = await hashPassword(DEFAULT_PASSWORD);

  for (const userData of seedUsers) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        name: userData.name,
        role: userData.role,
        emailVerified: true,
      },
    });

    await prisma.account.upsert({
      where: {
        accountId_providerId: {
          accountId: userData.email,
          providerId: "credential",
        },
      },
      update: { password: hashedPassword },
      create: {
        accountId: userData.email,
        providerId: "credential",
        password: hashedPassword,
        userId: user.id,
      },
    });
    console.log(`Seeded ${user.role}: ${user.email}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
