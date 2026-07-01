import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { logger } from "@hallpass/logger";
import { env } from "../env.js";
import { prisma, PassStatus } from "@hallpass/db";
import { releaseAndPromote, releaseSlot } from "./slots.js";
import { getTodayInTimezone } from "./time.js";
import { emitPassEvent } from "./socket.js";

const bullmqConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const passExpiryQueue = new Queue("pass-expiry", {
  connection: bullmqConnection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
});

// Uses a stable jobId so duplicate calls are idempotent (safe to call on pass creation and via
// reconcile-expiry). BullMQ silently ignores add() if a job with this id is already in the
// delayed queue, so reconcile cannot correct a stale fire time for an existing delayed job —
// it only re-queues jobs that were lost entirely (e.g. after a Redis flush).
export async function schedulePassExpiry(
  passId: number,
  periodEndTime: Date,
): Promise<void> {
  const delay = Math.max(0, periodEndTime.getTime() - Date.now());
  await passExpiryQueue.add(
    "expire",
    { passId },
    { jobId: `pass-${passId}`, delay },
  );
}

export async function processPassExpiry(job: Job): Promise<void> {
  const jobFiredAt = new Date();
  const { passId } = job.data as { passId: number };
  const pass = await prisma.pass.findUnique({
    where: { id: passId },
    include: {
      period: { select: { endTime: true } },
      destination: { select: { maxOccupancy: true } },
    },
  });
  if (!pass) return;

  const terminal: PassStatus[] = [
    PassStatus.COMPLETED,
    PassStatus.CANCELLED,
    PassStatus.DENIED,
    PassStatus.EXPIRED,
  ];
  if (terminal.includes(pass.status)) return;

  if (
    pass.status === PassStatus.PENDING ||
    pass.status === PassStatus.WAITING
  ) {
    const { count } = await prisma.pass.updateMany({
      where: { id: passId, status: { in: [PassStatus.PENDING, PassStatus.WAITING] } },
      data: { status: PassStatus.EXPIRED, expiredAt: new Date() },
    });
    if (count === 0) return;
    const updated = await prisma.pass.findUniqueOrThrow({ where: { id: passId } });
    emitPassEvent(updated, "pass:expired");
    return;
  }

  if (pass.status === PassStatus.ACTIVE) {
    const isLastPeriod = await checkIsLastPeriod(pass, jobFiredAt);
    const maxOccupancy = pass.destination.maxOccupancy;

    if (isLastPeriod) {
      const { count } = await prisma.pass.updateMany({
        where: { id: passId, status: PassStatus.ACTIVE },
        data: { status: PassStatus.COMPLETED, returnedAt: new Date() },
      });
      if (count === 0) return;
      const updated = await prisma.pass.findUniqueOrThrow({ where: { id: passId } });
      emitPassEvent(updated, "pass:returned");
      // Do not promote on the last period — there are no more periods today for a WAITING
      // student to be active in, and their own expiry job won't fire again.
      await releaseSlot(pass.destinationId, maxOccupancy);
    } else {
      const { count } = await prisma.pass.updateMany({
        where: { id: passId, status: PassStatus.ACTIVE },
        data: { status: PassStatus.EXPIRED, expiredAt: new Date() },
      });
      if (count === 0) return;
      const updated = await prisma.pass.findUniqueOrThrow({ where: { id: passId } });
      emitPassEvent(updated, "pass:expired");
      await releaseAndPromote(pass.destinationId, maxOccupancy);
    }
  }
}

// BullMQ does not close caller-provided ioredis instances on close() — keep a
// reference so closeQueue() can quit it during shutdown.
let workerConnection: Redis | undefined;

export function startExpiryWorker(): Worker {
  workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker("pass-expiry", processPassExpiry, {
    connection: workerConnection,
  });

  worker.on("error", (err) => logger.error(err, "[queue] worker error"));
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, passId: job?.data?.passId, err }, "[queue] job failed"),
  );
  return worker;
}

/**
 * Close the expiry queue and its Redis connections. Call worker.close() first
 * so in-flight jobs finish before the connections go away.
 */
export async function closeQueue(): Promise<void> {
  try {
    await passExpiryQueue.close();
  } catch (err) {
    logger.error(err, "[queue] error closing expiry queue");
  }
  try {
    await bullmqConnection.quit();
  } catch (err) {
    logger.error(err, "[queue] error closing queue connection");
  }
  if (workerConnection) {
    try {
      await workerConnection.quit();
    } catch (err) {
      logger.error(err, "[queue] error closing worker connection");
    }
  }
}

async function checkIsLastPeriod(
  pass: {
    periodId: number | null;
    schoolId: number;
    period: { endTime: string } | null;
  },
  referenceDate: Date,
): Promise<boolean> {
  if (!pass.periodId) return true;

  if (!pass.period) return true;

  const school = await prisma.school.findUnique({
    where: { id: pass.schoolId },
    select: { timezone: true },
  });

  const timezone = school?.timezone ?? "UTC";
  const todayInTz = getTodayInTimezone(timezone, referenceDate);
  const calendar = await prisma.schoolCalendar.findFirst({
    where: {
      schoolId: pass.schoolId,
      date: new Date(`${todayInTz}T00:00:00Z`),
    },
  });
  if (!calendar?.scheduleTypeId) return true;

  const laterPeriods = await prisma.period.findMany({
    where: {
      scheduleTypeId: calendar.scheduleTypeId,
      schoolId: pass.schoolId,
      startTime: { gt: pass.period.endTime },
      deletedAt: null,
    },
  });
  return laterPeriods.length === 0;
}
