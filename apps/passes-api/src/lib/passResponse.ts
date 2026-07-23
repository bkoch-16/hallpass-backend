import type { Prisma } from "@hallpass/db";
import type { PassResponse } from "@hallpass/types";

// Shared select/mapper for every Pass read that crosses the wire (REST and
// socket) — keeps the two payload shapes identical, per tech-debt.md §1.
export const PASS_SELECT = {
  id: true,
  schoolId: true,
  studentId: true,
  requesterId: true,
  destinationId: true,
  periodId: true,
  approverId: true,
  denierId: true,
  cancellerId: true,
  status: true,
  note: true,
  approverNote: true,
  denierNote: true,
  requestedAt: true,
  approvedAt: true,
  activatedAt: true,
  returnedAt: true,
  cancelledAt: true,
  deniedAt: true,
  expiredAt: true,
  student: { select: { name: true } },
  requester: { select: { name: true } },
  destination: { select: { name: true } },
  approver: { select: { name: true } },
  denier: { select: { name: true } },
  canceller: { select: { name: true } },
} as const;

export type PassRow = Prisma.PassGetPayload<{ select: typeof PASS_SELECT }>;

// PassRow is derived from PASS_SELECT, so this is where the compiler verifies
// the select list matches the PassResponse wire contract.
export function toPassResponse(pass: PassRow): PassResponse {
  const { student, requester, destination, approver, denier, canceller, ...rest } =
    pass;
  return {
    ...rest,
    studentName: student.name,
    requesterName: requester.name,
    destinationName: destination.name,
    approverName: approver?.name ?? null,
    denierName: denier?.name ?? null,
    cancellerName: canceller?.name ?? null,
  };
}
