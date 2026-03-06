import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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
    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: userData.email },
        update: { name: userData.name, role: userData.role },
        create: {
          email: userData.email,
          name: userData.name,
          role: userData.role,
          emailVerified: true,
        },
      });

      const existingAccount = await tx.account.findFirst({
        where: { accountId: userData.email, providerId: "credential" },
      });

      if (!existingAccount) {
        await tx.account.create({
          data: {
            accountId: userData.email,
            providerId: "credential",
            password: hashedPassword,
            userId: user.id,
          },
        });
      } else {
        await tx.account.update({
          where: { id: existingAccount.id },
          data: { password: hashedPassword },
        });
      }

      return user;
    });

    console.log(`Seeded ${user.role}: ${user.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
