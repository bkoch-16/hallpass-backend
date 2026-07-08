import { timingSafeEqual, createHash } from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import { prisma, PassStatus } from "@hallpass/db";
import { scheduleLocalExpiry, expirePass } from "../lib/expiry.js";
import { reconcileSlots, reconcileSchoolSlots, promoteFromQueue } from "../lib/slots.js";
import { getTodayInTimezone, periodEndDate } from "../lib/time.js";
import { env } from "../env.js";

const router = Router();

function requireInternalSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const rawAuth = req.headers["authorization"];
  const provided = typeof rawAuth === "string" ? rawAuth : "";
  const expected = `Bearer ${env.INTERNAL_SECRET}`;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  const valid = timingSafeEqual(hash(provided), hash(expected));
  if (!valid) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
}

const RECONCILE_BATCH_SIZE = 500;

router.post("/reconcile-expiry", requireInternalSecret, async (_req, res) => {
  let scheduled = 0;
  const errors: { passId: number; error: string }[] = [];

  // Batched scan — never load every in-flight pass into memory at once.
  let passCursor: number | undefined;
  while (true) {
    const batch = await prisma.pass.findMany({
      where: {
        status: {
          in: [PassStatus.PENDING, PassStatus.WAITING, PassStatus.ACTIVE],
        },
      },
      include: {
        period: { select: { endTime: true, scheduleType: { select: { endBuffer: true } } } },
        school: { select: { timezone: true } },
      },
      orderBy: { id: "asc" },
      take: RECONCILE_BATCH_SIZE,
      ...(passCursor !== undefined ? { cursor: { id: passCursor }, skip: 1 } : {}),
    });

    for (const pass of batch) {
      try {
        // A pass whose period was deleted (periodId null) has no derivable end time —
        // expire it now; expirePass treats a missing period as last-period and
        // resolves the pass safely. Likewise, a stale pass from a previous
        // school-local calendar day must expire now — periodEndDate is computed for
        // TODAY, so rescheduling would push it to today's period end.
        const timezone = pass.school.timezone;
        const isPriorDay =
          getTodayInTimezone(timezone, pass.requestedAt) < getTodayInTimezone(timezone);
        const endTime =
          pass.period && !isPriorDay
            ? periodEndDate(
                pass.period.endTime,
                pass.period.scheduleType?.endBuffer ?? 0,
                timezone,
              )
            : new Date();
        // Already due (past end time, prior day, or missing period) → resolve now
        // as the cold-path backstop. Otherwise (re-)arm the in-process timer on
        // this — possibly freshly-woken — instance.
        if (endTime.getTime() <= Date.now()) {
          await expirePass(pass.id);
        } else {
          scheduleLocalExpiry(pass.id, endTime);
        }
        scheduled++;
      } catch (err) {
        errors.push({
          passId: pass.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (batch.length < RECONCILE_BATCH_SIZE) break;
    passCursor = batch[batch.length - 1]!.id;
  }

  // Reconcile Redis slot counters for every destination with a configured cap —
  // derived from the source of truth (Destination.maxOccupancy), not from in-flight
  // passes, so a destination whose LAST pass reached a terminal state with a lost
  // slot release is still reconciled.
  const cappedDestinations = await prisma.destination.findMany({
    where: { maxOccupancy: { not: null } },
    select: { id: true, maxOccupancy: true },
  });
  let reconciled = 0;
  const reconcileErrors: { destinationId?: number; schoolId?: number; error: string }[] = [];
  for (const dest of cappedDestinations) {
    try {
      await reconcileSlots(dest.id, dest.maxOccupancy);
      reconciled++;
    } catch (err) {
      reconcileErrors.push({
        destinationId: dest.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Reconcile school-wide counters for every school with a configured active-pass cap.
  const cappedPolicies = await prisma.passPolicy.findMany({
    where: { maxActivePasses: { not: null } },
    select: { schoolId: true, maxActivePasses: true },
  });
  const capBySchool = new Map(
    cappedPolicies.map((p) => [p.schoolId, p.maxActivePasses]),
  );
  for (const policy of cappedPolicies) {
    try {
      await reconcileSchoolSlots(policy.schoolId, policy.maxActivePasses);
      reconciled++;
    } catch (err) {
      reconcileErrors.push({
        schoolId: policy.schoolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Heal lost promotions: a failed releaseAndPromote leaves an eligible WAITING
  // pass stranded even after the counters above are corrected. Promote once per
  // school that has WAITING passes, against the just-reconciled counters. Scope
  // comes from WAITING passes (not PassPolicy) so schools with an unlimited or
  // missing policy are healed too.
  const waitingSchools = await prisma.pass.findMany({
    where: { status: PassStatus.WAITING },
    distinct: ["schoolId"],
    select: { schoolId: true },
  });
  for (const { schoolId } of waitingSchools) {
    try {
      // Schools absent from capBySchool have no cap (no policy row, or a
      // null maxActivePasses) — both mean unlimited, matching getMaxActivePasses.
      await promoteFromQueue(schoolId, capBySchool.get(schoolId) ?? null);
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
