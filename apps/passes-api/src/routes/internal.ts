import { timingSafeEqual, createHash } from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import { prisma, PassStatus } from "@hallpass/db";
import { schedulePassExpiry } from "../lib/queue.js";
import { reconcileSlots, reconcileSchoolSlots, getMaxActivePasses } from "../lib/slots.js";
import { periodEndDate } from "../lib/time.js";
import { env } from "../env.js";

const router = Router();

function requireInternalSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const provided = req.headers["authorization"] ?? "";
  const expected = `Bearer ${env.INTERNAL_SECRET}`;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  const valid = timingSafeEqual(hash(provided), hash(expected));
  if (!valid) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
}

router.post("/reconcile-expiry", requireInternalSecret, async (_req, res) => {
  const activePasses = await prisma.pass.findMany({
    where: {
      status: {
        in: [PassStatus.PENDING, PassStatus.WAITING, PassStatus.ACTIVE],
      },
    },
    include: {
      period: { select: { endTime: true, scheduleType: { select: { endBuffer: true } } } },
      school: { select: { timezone: true } },
      destination: { select: { maxOccupancy: true } },
    },
  });

  let scheduled = 0;
  const errors: { passId: number; error: string }[] = [];

  for (const pass of activePasses) {
    try {
      // A pass whose period was deleted (periodId null) has no derivable end time —
      // arm an immediate expiry; processPassExpiry treats a missing period as
      // last-period and resolves the pass safely.
      const endTime = pass.period
        ? periodEndDate(
            pass.period.endTime,
            pass.period.scheduleType?.endBuffer ?? 0,
            pass.school.timezone,
          )
        : new Date();
      await schedulePassExpiry(pass.id, endTime);
      scheduled++;
    } catch (err) {
      errors.push({
        passId: pass.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reconcile Redis slot counters for every destination that has non-terminal passes.
  const destMaxOccupancy = new Map<number, number | null>();
  for (const pass of activePasses) {
    destMaxOccupancy.set(pass.destinationId, pass.destination.maxOccupancy);
  }
  let reconciled = 0;
  const reconcileErrors: { destinationId?: number; schoolId?: number; error: string }[] = [];
  for (const [destinationId, maxOccupancy] of destMaxOccupancy) {
    try {
      await reconcileSlots(destinationId, maxOccupancy);
      reconciled++;
    } catch (err) {
      reconcileErrors.push({
        destinationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reconcile school-wide counters for every school that has non-terminal passes.
  const schoolIds = new Set<number>();
  for (const pass of activePasses) {
    schoolIds.add(pass.schoolId);
  }
  for (const schoolId of schoolIds) {
    try {
      await reconcileSchoolSlots(schoolId, await getMaxActivePasses(schoolId));
      reconciled++;
    } catch (err) {
      reconcileErrors.push({
        schoolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hasErrors = errors.length > 0;
  const hasReconcileErrors = reconcileErrors.length > 0;
  const body = {
    scheduled,
    reconciled,
    ...(hasErrors ? { errors } : {}),
    ...(hasReconcileErrors ? { reconcileErrors } : {}),
  };

  if (scheduled === 0 && hasErrors) {
    res.status(500).json(body);
  } else if (hasErrors || hasReconcileErrors) {
    res.status(207).json(body);
  } else {
    res.status(200).json(body);
  }
});

export default router;
