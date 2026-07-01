import { prisma, PassStatus } from "@hallpass/db";
import { redis } from "./redis.js";
import { emitPassEvent } from "./socket.js";

const SLOT_TTL_SECONDS = 86400;

function slotKey(destinationId: number): string {
  return `slots:destination:${destinationId}`;
}

// Atomically initialise if missing, decrement, and restore if over-claimed — all in one round trip.
// Returns the remaining count (>= 0) on success, or -1 when no slot was available (counter already restored).
const LUA_CLAIM_SLOT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
if redis.call('EXISTS', key) == 0 then
  redis.call('SET', key, max, 'EX', ${SLOT_TTL_SECONDS})
end
local remaining = redis.call('DECR', key)
if remaining < 0 then
  redis.call('INCR', key)
  return -1
end
redis.call('EXPIRE', key, ${SLOT_TTL_SECONDS})
return remaining
`;

// Atomically increment then cap at max in a single round trip.
const LUA_RELEASE_SLOT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local val = redis.call('INCR', key)
if val > max then
  redis.call('SET', key, max, 'EX', ${SLOT_TTL_SECONDS})
  return max
end
redis.call('EXPIRE', key, ${SLOT_TTL_SECONDS})
return val
`;

/**
 * Atomically claim one slot.
 * - If maxOccupancy is null → unlimited, return true immediately.
 * - If maxOccupancy is 0 → never allow, return false immediately (avoids a Redis
 *   TTL-expiry race where the restore INCR could create a key at 1).
 * - Uses a Lua script to init-if-missing then DECR in one round trip.
 * - Returns true if a slot was claimed, false if none available.
 */
export async function claimSlot(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<boolean> {
  if (maxOccupancy === null) return true;
  if (maxOccupancy === 0) return false;

  const key = slotKey(destinationId);
  const remaining = (await redis.eval(
    LUA_CLAIM_SLOT,
    1,
    key,
    maxOccupancy,
  )) as number;

  return remaining >= 0;
}

/**
 * Atomically release one slot via INCR, capped at maxOccupancy.
 * No-op when maxOccupancy is null.
 */
export async function releaseSlot(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  if (maxOccupancy === null) return;
  await redis.eval(LUA_RELEASE_SLOT, 1, slotKey(destinationId), maxOccupancy);
}

/**
 * Release a slot then promote the oldest WAITING pass if one is available.
 * Used in return, cancel, and expiry paths to keep the queue moving.
 */
export async function releaseAndPromote(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  await releaseSlot(destinationId, maxOccupancy);
  await promoteFromQueue(destinationId, maxOccupancy);
}

/**
 * Reconcile the Redis counter against actual DB state.
 * SET counter = maxOccupancy - (# ACTIVE passes for this destination).
 * No-op when maxOccupancy is null.
 */
export async function reconcileSlots(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  if (maxOccupancy === null) return;

  const activeCount = await prisma.pass.count({
    where: { destinationId, status: PassStatus.ACTIVE },
  });

  await redis.set(
    slotKey(destinationId),
    Math.max(0, maxOccupancy - activeCount),
    "EX",
    SLOT_TTL_SECONDS,
  );
}

/**
 * Promote the oldest WAITING pass for a destination if a slot is available.
 * Uses updateMany with a status guard to be safe under concurrent promotions.
 */
export async function promoteFromQueue(
  destinationId: number,
  maxOccupancy: number | null,
  _isRetry = false,
): Promise<void> {
  const waiting = await prisma.pass.findFirst({
    where: { destinationId, status: PassStatus.WAITING },
    orderBy: { requestedAt: "asc" },
  });

  if (!waiting) return;

  const claimed = await claimSlot(destinationId, maxOccupancy);
  if (!claimed) return;

  const { count } = await prisma.pass.updateMany({
    where: { id: waiting.id, status: PassStatus.WAITING },
    data: { status: PassStatus.ACTIVE, activatedAt: new Date() },
  });

  if (count === 0) {
    // Another worker already promoted this pass — release the slot we claimed
    await releaseSlot(destinationId, maxOccupancy);
    if (!_isRetry) {
      await promoteFromQueue(destinationId, maxOccupancy, true);
    }
    return;
  }

  const promoted = await prisma.pass.findUniqueOrThrow({
    where: { id: waiting.id },
  });
  // Same event as a direct approval — SCHEMA_PLAN defines no separate promotion event
  emitPassEvent(promoted, "pass:approved");
}
