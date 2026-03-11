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

  await seedSchoolData(school.id);
}

async function seedSchoolData(schoolId: number) {
  // ScheduleTypes
  let standardDay = await prisma.scheduleType.findFirst({
    where: { schoolId, name: "Standard Day", deletedAt: null },
  });
  if (!standardDay) {
    standardDay = await prisma.scheduleType.create({
      data: { schoolId, name: "Standard Day", startBuffer: 15, endBuffer: 15 },
    });
  }
  console.log(`Seeded schedule type: ${standardDay.name}`);

  let lateStart = await prisma.scheduleType.findFirst({
    where: { schoolId, name: "Late Start", deletedAt: null },
  });
  if (!lateStart) {
    lateStart = await prisma.scheduleType.create({
      data: { schoolId, name: "Late Start", startBuffer: 15, endBuffer: 15 },
    });
  }
  console.log(`Seeded schedule type: ${lateStart.name}`);

  // Periods for Standard Day
  const standardDayPeriods = [
    { name: "Period 1", startTime: "08:00", endTime: "08:50", order: 0 },
    { name: "Period 2", startTime: "09:00", endTime: "09:50", order: 1 },
    { name: "Period 3", startTime: "10:00", endTime: "10:50", order: 2 },
    { name: "Lunch",    startTime: "11:00", endTime: "11:30", order: 3 },
    { name: "Period 4", startTime: "12:00", endTime: "12:50", order: 4 },
    { name: "Period 5", startTime: "13:00", endTime: "13:50", order: 5 },
  ];
  for (const p of standardDayPeriods) {
    const existing = await prisma.period.findFirst({
      where: { scheduleTypeId: standardDay.id, name: p.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.period.create({
        data: { schoolId, scheduleTypeId: standardDay.id, ...p },
      });
    }
  }
  console.log(`Seeded ${standardDayPeriods.length} periods for Standard Day`);

  // Periods for Late Start
  const lateStartPeriods = [
    { name: "Period 1", startTime: "09:00", endTime: "09:50", order: 0 },
    { name: "Period 2", startTime: "10:00", endTime: "10:50", order: 1 },
    { name: "Period 3", startTime: "11:00", endTime: "11:50", order: 2 },
    { name: "Lunch",    startTime: "12:00", endTime: "12:30", order: 3 },
    { name: "Period 4", startTime: "13:00", endTime: "13:50", order: 4 },
  ];
  for (const p of lateStartPeriods) {
    const existing = await prisma.period.findFirst({
      where: { scheduleTypeId: lateStart.id, name: p.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.period.create({
        data: { schoolId, scheduleTypeId: lateStart.id, ...p },
      });
    }
  }
  console.log(`Seeded ${lateStartPeriods.length} periods for Late Start`);

  // Destinations
  const destinations = [
    { name: "Library",       maxOccupancy: 20   },
    { name: "Bathroom",      maxOccupancy: null },
    { name: "Nurse's Office", maxOccupancy: 5   },
    { name: "Office",        maxOccupancy: null },
  ];
  for (const d of destinations) {
    const existing = await prisma.destination.findFirst({
      where: { schoolId, name: d.name, deletedAt: null },
    });
    if (!existing) {
      await prisma.destination.create({ data: { schoolId, ...d } });
    }
  }
  console.log(`Seeded ${destinations.length} destinations`);

  // PassPolicy (upsert — one per school)
  await prisma.passPolicy.upsert({
    where: { schoolId },
    update: {},
    create: { schoolId, maxActivePasses: 3, interval: "DAY", maxPerInterval: 5 },
  });
  console.log(`Seeded pass policy`);

  // SchoolCalendar
  const calendarEntries = [
    { date: new Date("2026-03-11T00:00:00.000Z"), scheduleTypeId: standardDay.id, note: null },
    { date: new Date("2026-03-12T00:00:00.000Z"), scheduleTypeId: lateStart.id,   note: "Late Start Wednesday" },
    { date: new Date("2026-03-13T00:00:00.000Z"), scheduleTypeId: standardDay.id, note: null },
    { date: new Date("2026-03-16T00:00:00.000Z"), scheduleTypeId: null,            note: "Spring Break" },
  ];
  for (const entry of calendarEntries) {
    await prisma.schoolCalendar.upsert({
      where: { schoolId_date: { schoolId, date: entry.date } },
      update: {},
      create: { schoolId, ...entry },
    });
  }
  console.log(`Seeded ${calendarEntries.length} calendar entries`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
