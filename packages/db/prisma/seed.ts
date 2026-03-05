import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Scrypt } from "oslo/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const scrypt = new Scrypt();

const seedUsers = [
  { email: "student@hallpass.dev", name: "Sample Student", role: "STUDENT" as const },
  { email: "teacher@hallpass.dev", name: "Sample Teacher", role: "TEACHER" as const },
  { email: "admin@hallpass.dev", name: "Sample Admin", role: "ADMIN" as const },
  { email: "superadmin@hallpass.dev", name: "Sample Super Admin", role: "SUPER_ADMIN" as const },
];

const DEFAULT_PASSWORD = "password";

async function main() {
  const hashedPassword = await scrypt.hash(DEFAULT_PASSWORD);

  for (const userData of seedUsers) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        name: userData.name,
        role: userData.role,
        emailVerified: true,
        accounts: {
          create: {
            accountId: userData.email,
            providerId: "credential",
            password: hashedPassword,
          },
        },
      },
    });
    console.log(`Seeded ${user.role}: ${user.email}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
