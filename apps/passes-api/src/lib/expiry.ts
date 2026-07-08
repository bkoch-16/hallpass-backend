import { logger } from "@hallpass/logger";
import { prisma, PassStatus } from "@hallpass/db";
import { releaseAndPromote, releasePassSlots, getMaxActivePasses } from "./slots.js";
import { calendarDate, getTodayInTimezone } from "./time.js";
import { emitPassEvent } from "./socket.js";

// setTimeout stores the delay in a 32-bit int; anything larger fires immediately.
// Passes always expire same-day so this is only a footgun guard — beyond the
// ceiling we skip the timer and let the reconcile sweep pick the pass up.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

// In-process timers keyed by passId. A pass expires promptly while its instance
// is warm (i.e. exactly when a staff board is watching, since an open WebSocket
// keeps the instance up); if the instance sleeps first the timer is lost and the
// `passes-reconcile-expiry` sweep resolves the pass on its next run.
const timers = new Map<number, NodeJS.Timeout>();

/**
 * Arm (or re-arm) an in-process timer that expires `passId` at `fireAt`.
 * Idempotent: replaces any existing timer for the id, so calling it again on
 * reconcile or a policy change simply moves the fire time.
 */
export function scheduleLocalExpiry(passId: number, fireAt: Date): void {
  const existing = timers.get(passId);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, fireAt.getTime() - Date.now());
  if (delay > MAX_TIMER_DELAY_MS) {
    timers.delete(passId);
    return;
  }

  const timer = setTimeout(() => {
    timers.delete(passId);
    void expirePass(passId).catch((err) =>
      logger.error({ passId, err }, "[expiry] timer expiry failed"),
    );
  }, delay);
  // Don't let a pending expiry timer keep the process alive during shutdown.
  timer.unref();
  timers.set(passId, timer);
}

/** Clear all pending expiry timers (graceful shutdown / tests). */
export function clearAllExpiryTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/**
 * Resolve a due pass: expire PENDING/WAITING, and for ACTIVE either COMPLETE it
 * on the last period of the day or EXPIRE + promote the next WAITING student.
 * Idempotent — every write is a status-guarded updateMany, so a duplicate call
 * (timer + overlapping reconcile) is safe.
 */
export async function expirePass(passId: number): Promise<void> {
  const firedAt = new Date();
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
    const isLastPeriod = await checkIsLastPeriod(pass, firedAt);
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
      // Release both counters but do not promote (no more periods today)
      await releasePassSlots(
        pass.schoolId,
        await getMaxActivePasses(pass.schoolId),
        pass.destinationId,
        maxOccupancy,
      );
    } else {
      const { count } = await prisma.pass.updateMany({
        where: { id: passId, status: PassStatus.ACTIVE },
        data: { status: PassStatus.EXPIRED, expiredAt: new Date() },
      });
      if (count === 0) return;
      const updated = await prisma.pass.findUniqueOrThrow({ where: { id: passId } });
      emitPassEvent(updated, "pass:expired");
      await releaseAndPromote(pass.schoolId, pass.destinationId, maxOccupancy);
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
      date: calendarDate(todayInTz),
    },
  });
  if (!calendar?.scheduleTypeId) return true;

  const laterPeriods = await prisma.period.findMany({
    where: {
      scheduleTypeId: calendar.scheduleTypeId,
      schoolId: pass.schoolId,
      // gte, not gt: back-to-back schedules start the next period exactly at this endTime
      startTime: { gte: pass.period.endTime },
      deletedAt: null,
    },
  });
  return laterPeriods.length === 0;
}
