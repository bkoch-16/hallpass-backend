import { Router, Request, Response } from "express";
import { prisma } from "@hallpass/db";
import { UserRole } from "@hallpass/types";
import type { PassPolicyResponse } from "@hallpass/types";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roleGuard";
import { validateBody } from "../middleware/validate";
import { requireSchoolAccess } from "../middleware/schoolScope";
import { upsertPolicySchema } from "../schemas/policy";

const router = Router({ mergeParams: true });

const POLICY_SELECT = {
  id: true,
  schoolId: true,
  maxActivePasses: true,
  interval: true,
  maxPerInterval: true,
} as const;

type PolicyRow = {
  id: string;
  schoolId: number;
  maxActivePasses: number | null;
  interval: string | null;
  maxPerInterval: number | null;
};

function toPolicyResponse(p: PolicyRow): PassPolicyResponse {
  return {
    id: p.id,
    schoolId: p.schoolId,
    maxActivePasses: p.maxActivePasses,
    interval: p.interval as PassPolicyResponse["interval"],
    maxPerInterval: p.maxPerInterval,
  };
}

router.get("/", requireAuth, requireSchoolAccess, async (req: Request, res: Response) => {
  const schoolId = Number(req.params.schoolId);

  const policy = await prisma.passPolicy.findUnique({
    where: { schoolId },
    select: POLICY_SELECT,
  });

  if (!policy) {
    res.status(404).json({ message: "No policy set for this school" });
    return;
  }

  res.json(toPolicyResponse(policy));
});

router.put(
  "/",
  requireAuth,
  requireSchoolAccess,
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validateBody(upsertPolicySchema),
  async (req: Request, res: Response) => {
    const schoolId = Number(req.params.schoolId);

    const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
    if (!school) {
      res.status(404).json({ message: "School not found" });
      return;
    }

    const policy = await prisma.passPolicy.upsert({
      where: { schoolId },
      create: {
        schoolId,
        maxActivePasses: req.body.maxActivePasses ?? null,
        interval: req.body.interval ?? null,
        maxPerInterval: req.body.maxPerInterval ?? null,
      },
      update: {
        maxActivePasses: req.body.maxActivePasses ?? null,
        interval: req.body.interval ?? null,
        maxPerInterval: req.body.maxPerInterval ?? null,
      },
      select: POLICY_SELECT,
    });

    res.json(toPolicyResponse(policy));
  },
);

export default router;
