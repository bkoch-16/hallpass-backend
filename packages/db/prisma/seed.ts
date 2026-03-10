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
  { email: "student@hallpass.dev", name: "Sample Student", role: "STUDENT" as const, assignSchool: true },
  { email: "teacher@hallpass.dev", name: "Sample Teacher", role: "TEACHER" as const, assignSchool: true },
  { email: "admin@hallpass.dev", name: "Sample Admin", role: "ADMIN" as const, assignSchool: true },
  { email: "superadmin@hallpass.dev", name: "Sample Super Admin", role: "SUPER_ADMIN" as const, assignSchool: false },
];

const DEFAULT_PASSWORD = "password";

async function main() {
  const hashedPassword = await hashPassword(DEFAULT_PASSWORD);

  let district = await prisma.district.findFirst({ where: { name: "Demo District" } });
  if (!district) {
    district = await prisma.district.create({ data: { name: "Demo District" } });
  }
  console.log(`Seeded district: ${district.name}`);

  let school = await prisma.school.findFirst({ where: { name: "Demo High School" } });
  if (!school) {
    school = await prisma.school.create({ data: { name: "Demo High School", districtId: district.id } });
  }
  console.log(`Seeded school: ${school.name}`);

  for (const userData of seedUsers) {
    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: userData.email },
        update: {},
        create: {
          email: userData.email,
          name: userData.name,
          role: userData.role,
          emailVerified: true,
          schoolId: userData.assignSchool ? school.id : null,
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
