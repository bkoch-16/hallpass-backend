import { prisma } from '@hallpass/db';
import { redis } from './redis.js';

function slotKey(destinationId: number): string {
  return `slots:destination:${destinationId}`;
}

/**
 * SET slots:destination:{id} {maxOccupancy} NX EX 86400
 * Returns true if the key was newly set, false if it already existed.
 * No-op (returns false) when maxOccupancy is null/undefined.
 */
export async function initSlots(destinationId: number, maxOccupancy: number | null | undefined): Promise<boolean> {
  if (maxOccupancy == null) return false;
  const result = await redis.set(slotKey(destinationId), maxOccupancy, 'NX', 'EX', 86400);
  return result === 'OK';
}

/**
 * Atomically claim one slot via DECR.
 * - If maxOccupancy is null → unlimited, return true immediately.
 * - If the key didn't exist (DECR yields -1 starting from 0): init and retry once.
 * - If DECR result >= 0 → claimed, return true.
 * - If DECR result < 0 → no slots, INCR back and return false.
 */
export async function claimSlot(destinationId: number, maxOccupancy: number | null): Promise<boolean> {
  if (maxOccupancy === null) return true;

  const key = slotKey(destinationId);
  let remaining = await redis.decr(key);

  // Key didn't exist: DECR on a missing key creates it at 0 then decrements to -1
  if (remaining === -1) {
    await redis.incr(key); // restore to 0 before reinitialising
    await initSlots(destinationId, maxOccupancy);
    remaining = await redis.decr(key);
  }

  if (remaining >= 0) {
    return true;
  }

  // Overdrawn — restore the counter
  await redis.incr(key);
  return false;
}

/**
 * Release one slot back via INCR, then cap at maxOccupancy.
 * No-op when maxOccupancy is null.
 */
export async function releaseSlot(destinationId: number, maxOccupancy: number | null): Promise<void> {
  if (maxOccupancy === null) return;

  const key = slotKey(destinationId);
  const current = await redis.incr(key);

  if (current > maxOccupancy) {
    await redis.set(key, maxOccupancy);
  }
}

/**
 * Reconcile the Redis counter against actual DB state.
 * SET counter = maxOccupancy - (# ACTIVE passes for this destination).
 * No-op when maxOccupancy is null.
 */
export async function reconcileSlots(destinationId: number, maxOccupancy: number | null): Promise<void> {
  if (maxOccupancy === null) return;

  const activeCount = await prisma.pass.count({
    where: { destinationId, status: 'ACTIVE' },
  });

  await redis.set(slotKey(destinationId), maxOccupancy - activeCount);
}

/**
 * Promote the oldest WAITING pass for a destination if a slot is available.
 * No-op when maxOccupancy is null (unlimited — passes go straight to ACTIVE anyway).
 */
export async function promoteFromQueue(destinationId: number, maxOccupancy: number | null): Promise<void> {
  const waiting = await prisma.pass.findFirst({
    where: { destinationId, status: 'WAITING' },
    orderBy: { requestedAt: 'asc' },
  });

  if (!waiting) return;

  const claimed = await claimSlot(destinationId, maxOccupancy);
  if (!claimed) return;

  await prisma.pass.update({
    where: { id: waiting.id },
    data: {
      status: 'ACTIVE',
      approvedAt: new Date(),
    },
  });

  // TODO: emit socket event pass:promoted (Phase 5 will add this)
}
