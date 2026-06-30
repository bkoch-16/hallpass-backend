import { prisma } from '@hallpass/db';
import { redis } from './redis.js';
import { emitPassEvent } from './socket.js';

function slotKey(destinationId: number): string {
  return `slots:destination:${destinationId}`;
}

// Atomically initialise the key if it doesn't exist, then decrement.
// Returns the new counter value (>= 0 = claimed, < 0 = no slot).
const LUA_CLAIM_SLOT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
if redis.call('EXISTS', key) == 0 then
  redis.call('SET', key, max, 'EX', 86400)
end
return redis.call('DECR', key)
`;

/**
 * SET slots:destination:{id} {maxOccupancy} NX EX 86400
 * Returns true if the key was newly set, false if it already existed.
 * No-op (returns false) when maxOccupancy is null/undefined.
 */
export async function initSlots(destinationId: number, maxOccupancy: number | null | undefined): Promise<boolean> {
  if (maxOccupancy == null) return false;
  const result = await redis.set(slotKey(destinationId), maxOccupancy, 'EX', 86400, 'NX');
  return result === 'OK';
}

/**
 * Atomically claim one slot.
 * - If maxOccupancy is null → unlimited, return true immediately.
 * - Uses a Lua script to init-if-missing then DECR in one round trip.
 * - Returns true if a slot was claimed, false if none available.
 */
export async function claimSlot(destinationId: number, maxOccupancy: number | null): Promise<boolean> {
  if (maxOccupancy === null) return true;

  const key = slotKey(destinationId);
  const remaining = await redis.eval(LUA_CLAIM_SLOT, 1, key, maxOccupancy) as number;

  if (remaining >= 0) return true;

  await redis.incr(key); // restore the counter
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
 * Release a slot then promote the oldest WAITING pass if one is available.
 * Used in return, cancel, and expiry paths to keep the queue moving.
 */
export async function releaseAndPromote(destinationId: number, maxOccupancy: number | null): Promise<void> {
  await releaseSlot(destinationId, maxOccupancy);
  await promoteFromQueue(destinationId, maxOccupancy);
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
 * Uses updateMany with a status guard to be safe under concurrent promotions.
 */
export async function promoteFromQueue(destinationId: number, maxOccupancy: number | null): Promise<void> {
  const waiting = await prisma.pass.findFirst({
    where: { destinationId, status: 'WAITING' },
    orderBy: { requestedAt: 'asc' },
  });

  if (!waiting) return;

  const claimed = await claimSlot(destinationId, maxOccupancy);
  if (!claimed) return;

  const { count } = await prisma.pass.updateMany({
    where: { id: waiting.id, status: 'WAITING' },
    data: { status: 'ACTIVE', approvedAt: new Date() },
  });

  if (count === 0) {
    // Another worker already promoted this pass — release the slot we claimed
    await releaseSlot(destinationId, maxOccupancy);
    return;
  }

  const promoted = await prisma.pass.findUniqueOrThrow({ where: { id: waiting.id } });
  emitPassEvent(promoted, 'pass:promoted');
}
