import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createAuth, createUserWithCredential, EmailInUseError } from "@hallpass/auth";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}
if (!process.env.BETTER_AUTH_URL) {
  throw new Error("BETTER_AUTH_URL environment variable is not set");
}
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET environment variable is not set");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const auth = createAuth({
  prisma,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
});

const seedUsers = [
  { email: "student@gohallhero.com", name: "Sample Student", role: "STUDENT" as const, assignSchool: true, pinCode: "482913" },
  { email: "alex.rivera@gohallhero.com", name: "Alex Rivera", role: "STUDENT" as const, assignSchool: true, pinCode: "274859" },
  { email: "jordan.lee@gohallhero.com", name: "Jordan Lee", role: "STUDENT" as const, assignSchool: true, pinCode: "391026" },
  { email: "morgan.diaz@gohallhero.com", name: "Morgan Diaz", role: "STUDENT" as const, assignSchool: true, pinCode: "518734" },
  { email: "casey.nguyen@gohallhero.com", name: "Casey Nguyen", role: "STUDENT" as const, assignSchool: true, pinCode: "629451" },
  { email: "teacher@gohallhero.com", name: "Sample Teacher", role: "TEACHER" as const, assignSchool: true },
  { email: "admin@gohallhero.com", name: "Sample Admin", role: "ADMIN" as const, assignSchool: true },
  { email: "superadmin@gohallhero.com", name: "Sample Super Admin", role: "SUPER_ADMIN" as const, assignSchool: false },
];

const DEFAULT_PASSWORD = "password";

// Demo school's timezone is the default "America/Los_Angeles", which is UTC-7
// (PDT) for the entire seeded date range below — no DST transitions to handle.
function schoolTime(dateStr: string, time: string): Date {
  return new Date(`${dateStr}T${time}:00-07:00`);
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function main() {
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
    try {
      await createUserWithCredential(auth, {
        email: userData.email,
        password: DEFAULT_PASSWORD,
        name: userData.name,
        role: userData.role,
        schoolId: userData.assignSchool ? school.id : null,
      });
      console.log(`Seeded ${userData.role}: ${userData.email}`);
      await prisma.user.update({
        where: { email: userData.email },
        data: { pinCode: userData.pinCode ?? null },
      });
    } catch (e) {
      if (e instanceof EmailInUseError) {
        console.log(`Skipped existing ${userData.role}: ${userData.email}`);
      } else {
        throw e;
      }
    }
  }

  await seedSchoolData(school.id);
  await seedPasses(school.id);
}

async function seedSchoolData(schoolId: number) {
  // Retire the old placeholder schedule types (soft delete keeps any historical
  // Period/Pass references intact) in favor of Regular / Minimum Day / Homecoming.
  await prisma.scheduleType.updateMany({
    where: { schoolId, name: { in: ["Standard Day", "Late Start"] }, deletedAt: null },
    data: { deletedAt: new Date("2026-07-14T00:00:00.000Z") },
  });

  // ScheduleTypes — all start at 8:30, differ by end time.
  const scheduleTypeDefs = [
    { name: "Regular", startBuffer: 15, endBuffer: 15 },
    { name: "Minimum Day", startBuffer: 10, endBuffer: 10 },
    { name: "Homecoming", startBuffer: 10, endBuffer: 10 },
  ];
  const scheduleTypes = new Map<string, { id: number; name: string }>();
  for (const st of scheduleTypeDefs) {
    let scheduleType = await prisma.scheduleType.findFirst({
      where: { schoolId, name: st.name, deletedAt: null },
    });
    if (!scheduleType) {
      scheduleType = await prisma.scheduleType.create({ data: { schoolId, ...st } });
    }
    scheduleTypes.set(st.name, scheduleType);
    console.log(`Seeded schedule type: ${scheduleType.name}`);
  }

  // Each schedule's 6 periods are all the same length (uniform per
  // schedule); lunch's position among them is whatever gets its start time
  // closest to 11:30 given that period length. Minimum Day's periods are
  // short enough that lunch falls after Period 4 to land exactly on 11:30;
  // Regular and Homecoming land 15 min off (11:45 and 11:15) since no
  // 3rd/4th-period split gets closer without an unreasonably long period or
  // lunch length.
  const periodsBySchedule: Record<string, { name: string; startTime: string; endTime: string; order: number }[]> = {
    Regular: [
      { name: "Period 1", startTime: "08:30", endTime: "09:30", order: 0 },
      { name: "Period 2", startTime: "09:35", endTime: "10:35", order: 1 },
      { name: "Period 3", startTime: "10:40", endTime: "11:40", order: 2 },
      { name: "Lunch",    startTime: "11:45", endTime: "12:10", order: 3 },
      { name: "Period 4", startTime: "12:15", endTime: "13:15", order: 4 },
      { name: "Period 5", startTime: "13:20", endTime: "14:20", order: 5 },
      { name: "Period 6", startTime: "14:25", endTime: "15:25", order: 6 },
    ],
    "Minimum Day": [
      { name: "Period 1", startTime: "08:30", endTime: "09:10", order: 0 },
      { name: "Period 2", startTime: "09:15", endTime: "09:55", order: 1 },
      { name: "Period 3", startTime: "10:00", endTime: "10:40", order: 2 },
      { name: "Period 4", startTime: "10:45", endTime: "11:25", order: 3 },
      { name: "Lunch",    startTime: "11:30", endTime: "11:55", order: 4 },
      { name: "Period 5", startTime: "12:00", endTime: "12:40", order: 5 },
      { name: "Period 6", startTime: "12:45", endTime: "13:25", order: 6 },
    ],
    Homecoming: [
      { name: "Period 1", startTime: "08:30", endTime: "09:20", order: 0 },
      { name: "Period 2", startTime: "09:25", endTime: "10:15", order: 1 },
      { name: "Period 3", startTime: "10:20", endTime: "11:10", order: 2 },
      { name: "Lunch",    startTime: "11:15", endTime: "11:40", order: 3 },
      { name: "Period 4", startTime: "11:45", endTime: "12:35", order: 4 },
      { name: "Period 5", startTime: "12:40", endTime: "13:30", order: 5 },
      { name: "Period 6", startTime: "13:35", endTime: "14:25", order: 6 },
    ],
  };
  // Periods are fully replaced each run so schedule/length tweaks always take
  // effect; existing rows are soft-deleted rather than dropped so any Pass
  // referencing them keeps its history intact.
  for (const [scheduleName, periods] of Object.entries(periodsBySchedule)) {
    const scheduleType = scheduleTypes.get(scheduleName)!;
    await prisma.period.updateMany({
      where: { scheduleTypeId: scheduleType.id, deletedAt: null },
      data: { deletedAt: new Date("2026-07-15T00:00:00.000Z") },
    });
    for (const p of periods) {
      await prisma.period.create({
        data: { schoolId, scheduleTypeId: scheduleType.id, ...p },
      });
    }
    console.log(`Seeded ${periods.length} periods for ${scheduleName}`);
  }

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

  // SchoolCalendar — this week through next Friday. The old placeholder
  // March entries are gone now that they no longer reference a live
  // schedule type, so they're dropped in favor of this range.
  await prisma.schoolCalendar.deleteMany({ where: { schoolId } });

  const regular = scheduleTypes.get("Regular")!;
  const minimumDay = scheduleTypes.get("Minimum Day")!;
  const homecoming = scheduleTypes.get("Homecoming")!;
  const calendarEntries = [
    { date: new Date("2026-07-13T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-14T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-15T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-16T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-17T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-20T00:00:00.000Z"), scheduleTypeId: minimumDay.id,  note: "Minimum Day" },
    { date: new Date("2026-07-21T00:00:00.000Z"), scheduleTypeId: homecoming.id,  note: "Homecoming" },
    { date: new Date("2026-07-22T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-23T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
    { date: new Date("2026-07-24T00:00:00.000Z"), scheduleTypeId: regular.id,     note: null },
  ];
  for (const entry of calendarEntries) {
    await prisma.schoolCalendar.create({ data: { schoolId, ...entry } });
  }
  console.log(`Seeded ${calendarEntries.length} calendar entries`);
}

async function seedPasses(schoolId: number) {
  const teacher = await prisma.user.findUnique({ where: { email: "teacher@gohallhero.com" } });
  if (!teacher) throw new Error("Teacher not seeded");

  const students = await prisma.user.findMany({ where: { schoolId, role: "STUDENT", deletedAt: null } });
  const studentByEmail = new Map(students.map((s) => [s.email, s]));

  const destinations = await prisma.destination.findMany({ where: { schoolId, deletedAt: null } });
  const destinationByName = new Map(destinations.map((d) => [d.name, d]));

  const regular = await prisma.scheduleType.findFirst({ where: { schoolId, name: "Regular", deletedAt: null } });
  if (!regular) throw new Error("Regular schedule type not seeded");
  const minimumDay = await prisma.scheduleType.findFirst({ where: { schoolId, name: "Minimum Day", deletedAt: null } });
  if (!minimumDay) throw new Error("Minimum Day schedule type not seeded");

  const regularPeriods = await prisma.period.findMany({ where: { scheduleTypeId: regular.id, deletedAt: null } });
  const minimumDayPeriods = await prisma.period.findMany({ where: { scheduleTypeId: minimumDay.id, deletedAt: null } });
  const periodsByScheduleType: Record<"Regular" | "Minimum Day", Map<string, (typeof regularPeriods)[number]>> = {
    Regular: new Map(regularPeriods.map((p) => [p.name, p])),
    "Minimum Day": new Map(minimumDayPeriods.map((p) => [p.name, p])),
  };

  // Periods get fresh ids each run (see seedSchoolData), so passes are
  // replaced wholesale rather than deduped against stale period references.
  await prisma.pass.deleteMany({ where: { schoolId } });

  const passSeeds: {
    date: string;
    studentEmail: string;
    periodName: string;
    destinationName: string;
    status: "COMPLETED" | "DENIED" | "CANCELLED";
    scheduleType?: "Regular" | "Minimum Day";
  }[] = [
    { date: "2026-07-13", studentEmail: "student@gohallhero.com",      periodName: "Period 2", destinationName: "Bathroom",       status: "COMPLETED" },
    { date: "2026-07-13", studentEmail: "alex.rivera@gohallhero.com",  periodName: "Period 4", destinationName: "Library",        status: "COMPLETED" },
    { date: "2026-07-13", studentEmail: "jordan.lee@gohallhero.com",   periodName: "Period 6", destinationName: "Nurse's Office",  status: "COMPLETED" },

    { date: "2026-07-14", studentEmail: "morgan.diaz@gohallhero.com",  periodName: "Period 1", destinationName: "Bathroom",       status: "COMPLETED" },
    { date: "2026-07-14", studentEmail: "student@gohallhero.com",      periodName: "Period 5", destinationName: "Office",         status: "COMPLETED" },
    { date: "2026-07-14", studentEmail: "casey.nguyen@gohallhero.com", periodName: "Period 3", destinationName: "Library",        status: "DENIED" },
    { date: "2026-07-14", studentEmail: "alex.rivera@gohallhero.com",  periodName: "Period 6", destinationName: "Bathroom",       status: "COMPLETED" },

    { date: "2026-07-15", studentEmail: "jordan.lee@gohallhero.com",   periodName: "Period 2", destinationName: "Nurse's Office",  status: "COMPLETED" },
    { date: "2026-07-15", studentEmail: "casey.nguyen@gohallhero.com", periodName: "Period 4", destinationName: "Bathroom",       status: "COMPLETED" },
    { date: "2026-07-15", studentEmail: "morgan.diaz@gohallhero.com",  periodName: "Period 6", destinationName: "Library",        status: "CANCELLED" },

    { date: "2026-07-16", studentEmail: "student@gohallhero.com",      periodName: "Period 1", destinationName: "Office",         status: "COMPLETED" },
    { date: "2026-07-16", studentEmail: "alex.rivera@gohallhero.com",  periodName: "Period 3", destinationName: "Bathroom",       status: "COMPLETED" },
    { date: "2026-07-16", studentEmail: "jordan.lee@gohallhero.com",   periodName: "Period 5", destinationName: "Nurse's Office",  status: "COMPLETED" },
    { date: "2026-07-16", studentEmail: "casey.nguyen@gohallhero.com", periodName: "Period 6", destinationName: "Library",        status: "COMPLETED" },

    { date: "2026-07-17", studentEmail: "morgan.diaz@gohallhero.com",  periodName: "Period 2", destinationName: "Bathroom",       status: "COMPLETED" },
    { date: "2026-07-17", studentEmail: "alex.rivera@gohallhero.com",  periodName: "Period 4", destinationName: "Nurse's Office",  status: "COMPLETED" },
    { date: "2026-07-17", studentEmail: "student@gohallhero.com",      periodName: "Period 6", destinationName: "Library",        status: "DENIED" },
    { date: "2026-07-17", studentEmail: "casey.nguyen@gohallhero.com", periodName: "Period 1", destinationName: "Office",         status: "COMPLETED" },

    // Minimum Day — only periods that fall before noon PST (Period 1-4; Lunch/Period 5+ start at or after noon).
    { date: "2026-07-20", studentEmail: "jordan.lee@gohallhero.com",   periodName: "Period 1", destinationName: "Library",        status: "COMPLETED", scheduleType: "Minimum Day" },
    { date: "2026-07-20", studentEmail: "casey.nguyen@gohallhero.com", periodName: "Period 2", destinationName: "Bathroom",       status: "COMPLETED", scheduleType: "Minimum Day" },
    { date: "2026-07-20", studentEmail: "morgan.diaz@gohallhero.com",  periodName: "Period 3", destinationName: "Nurse's Office",  status: "DENIED",    scheduleType: "Minimum Day" },
    { date: "2026-07-20", studentEmail: "alex.rivera@gohallhero.com",  periodName: "Period 4", destinationName: "Office",         status: "COMPLETED", scheduleType: "Minimum Day" },
  ];

  let created = 0;
  for (const seed of passSeeds) {
    const student = studentByEmail.get(seed.studentEmail);
    const destination = destinationByName.get(seed.destinationName);
    const period = periodsByScheduleType[seed.scheduleType ?? "Regular"].get(seed.periodName);
    if (!student || !destination || !period) {
      throw new Error(`Missing reference for pass seed: ${JSON.stringify(seed)}`);
    }

    const requestedAt = schoolTime(seed.date, addMinutes(period.startTime, 3));
    const base = {
      schoolId,
      studentId: student.id,
      requesterId: student.id,
      destinationId: destination.id,
      periodId: period.id,
      requestedAt,
    };

    if (seed.status === "COMPLETED") {
      const approvedAt = schoolTime(seed.date, addMinutes(period.startTime, 5));
      const returnedAt = schoolTime(seed.date, addMinutes(period.endTime, -5));
      await prisma.pass.create({
        data: {
          ...base,
          status: "COMPLETED",
          approverId: teacher.id,
          approvedAt,
          activatedAt: approvedAt,
          returnedAt,
        },
      });
    } else if (seed.status === "DENIED") {
      const deniedAt = schoolTime(seed.date, addMinutes(period.startTime, 7));
      await prisma.pass.create({
        data: {
          ...base,
          status: "DENIED",
          denierId: teacher.id,
          deniedAt,
          denierNote: "Please wait until passing period",
        },
      });
    } else {
      const cancelledAt = schoolTime(seed.date, addMinutes(period.startTime, 9));
      await prisma.pass.create({
        data: {
          ...base,
          status: "CANCELLED",
          cancellerId: student.id,
          cancelledAt,
        },
      });
    }
    created++;
  }
  console.log(`Seeded ${created} passes`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
