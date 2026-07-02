import { prisma, PassStatus } from "@hallpass/db";
import { redis } from "./redis.js";
import { emitPassEvent } from "./socket.js";

const SLOT_TTL_SECONDS = 86400;

function slotKey(destinationId: number): string {
  return `slots:destination:${destinationId}`;
}

function schoolSlotKey(schoolId: number): string {
  return `slots:school:${schoolId}`;
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
 * Atomically claim one slot for a counter key.
 * - If max is null → unlimited, return true immediately.
 * - If max is 0 → never allow, return false immediately (avoids a Redis
 *   TTL-expiry race where the restore INCR could create a key at 1).
 * - Uses a Lua script to init-if-missing then DECR in one round trip.
 * - Returns true if a slot was claimed, false if none available.
 */
async function claimSlotByKey(key: string, max: number | null): Promise<boolean> {
  if (max === null) return true;
  if (max === 0) return false;
  const remaining = (await redis.eval(LUA_CLAIM_SLOT, 1, key, max)) as number;
  return remaining >= 0;
}

/**
 * Atomically release one slot via INCR, capped at max.
 * No-op when max is null.
 */
async function releaseSlotByKey(key: string, max: number | null): Promise<void> {
  if (max === null) return;
  await redis.eval(LUA_RELEASE_SLOT, 1, key, max);
}

/** Atomically claim one destination slot. */
export async function claimSlot(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<boolean> {
  return claimSlotByKey(slotKey(destinationId), maxOccupancy);
}

/** Atomically release one destination slot. */
export async function releaseSlot(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  return releaseSlotByKey(slotKey(destinationId), maxOccupancy);
}

/** Atomically claim one school-wide active-pass slot. */
export async function claimSchoolSlot(
  schoolId: number,
  maxActivePasses: number | null,
): Promise<boolean> {
  return claimSlotByKey(schoolSlotKey(schoolId), maxActivePasses);
}

/** Atomically release one school-wide active-pass slot. */
export async function releaseSchoolSlot(
  schoolId: number,
  maxActivePasses: number | null,
): Promise<void> {
  return releaseSlotByKey(schoolSlotKey(schoolId), maxActivePasses);
}

/** Look up the school's maxActivePasses policy (null = unlimited). */
export async function getMaxActivePasses(schoolId: number): Promise<number | null> {
  const policy = await prisma.passPolicy.findFirst({
    where: { schoolId },
    select: { maxActivePasses: true },
  });
  return policy?.maxActivePasses ?? null;
}

/**
 * Claim one destination slot AND one school-wide slot.
 * Returns true only when both were claimed; on partial claim the
 * destination slot is released before returning false.
 */
export async function claimPassSlots(
  schoolId: number,
  maxActivePasses: number | null,
  destinationId: number,
  maxOccupancy: number | null,
): Promise<boolean> {
  const destClaimed = await claimSlot(destinationId, maxOccupancy);
  if (!destClaimed) return false;
  const schoolClaimed = await claimSchoolSlot(schoolId, maxActivePasses);
  if (!schoolClaimed) {
    await releaseSlot(destinationId, maxOccupancy);
    return false;
  }
  return true;
}

/** Release one destination slot AND one school-wide slot. */
export async function releasePassSlots(
  schoolId: number,
  maxActivePasses: number | null,
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  await releaseSlot(destinationId, maxOccupancy);
  await releaseSchoolSlot(schoolId, maxActivePasses);
}

/**
 * Release both slots then promote the oldest promotable WAITING pass in the school.
 * Used in return and expiry paths to keep the queue moving.
 */
export async function releaseAndPromote(
  schoolId: number,
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  const maxActivePasses = await getMaxActivePasses(schoolId);
  await releasePassSlots(schoolId, maxActivePasses, destinationId, maxOccupancy);
  await promoteFromQueue(schoolId, maxActivePasses);
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
 * Reconcile the school-wide Redis counter against actual DB state.
 * SET counter = maxActivePasses - (# ACTIVE passes for this school).
 * No-op when maxActivePasses is null.
 */
export async function reconcileSchoolSlots(
  schoolId: number,
  maxActivePasses: number | null,
): Promise<void> {
  if (maxActivePasses === null) return;

  const activeCount = await prisma.pass.count({
    where: { schoolId, status: PassStatus.ACTIVE },
  });

  await redis.set(
    schoolSlotKey(schoolId),
    Math.max(0, maxActivePasses - activeCount),
    "EX",
    SLOT_TTL_SECONDS,
  );
}

/**
 * Promote at most one WAITING pass for the school, oldest-first grouped by
 * destination (a full destination must not starve passes headed elsewhere —
 * SCHEMA_PLAN "Queue promotion on slot freed"). Claims BOTH the destination
 * and school counters; if the school cap is exhausted, promotion stops entirely.
 * Uses updateMany with a status guard to be safe under concurrent promotions.
 */
export async function promoteFromQueue(
  schoolId: number,
  maxActivePasses: number | null,
): Promise<void> {
  const waiting = await prisma.pass.findMany({
    where: { schoolId, status: PassStatus.WAITING },
    orderBy: { requestedAt: "asc" },
    include: { destination: { select: { maxOccupancy: true } } },
  });
  if (waiting.length === 0) return;

  const triedDestinations = new Set<number>();
  for (const candidate of waiting) {
    // Only the oldest WAITING pass per destination is promotable (FIFO per destination)
    if (triedDestinations.has(candidate.destinationId)) continue;
    triedDestinations.add(candidate.destinationId);

    const maxOccupancy = candidate.destination.maxOccupancy;
    const destClaimed = await claimSlot(candidate.destinationId, maxOccupancy);
    if (!destClaimed) continue; // destination full — try the next destination

    const schoolClaimed = await claimSchoolSlot(schoolId, maxActivePasses);
    if (!schoolClaimed) {
      // School-wide cap exhausted — nothing in this school can be promoted
      await releaseSlot(candidate.destinationId, maxOccupancy);
      return;
    }

    const { count } = await prisma.pass.updateMany({
      where: { id: candidate.id, status: PassStatus.WAITING },
      data: { status: PassStatus.ACTIVE, activatedAt: new Date() },
    });

    if (count === 0) {
      // Another worker already promoted this pass — give back both slots and
      // let the loop try the next candidate (replaces the old _isRetry recursion)
      await releasePassSlots(schoolId, maxActivePasses, candidate.destinationId, maxOccupancy);
      continue;
    }

    const promoted = await prisma.pass.findUniqueOrThrow({ where: { id: candidate.id } });
    // Same event as a direct approval — SCHEMA_PLAN defines no separate promotion event
    emitPassEvent(promoted, "pass:approved");
    return; // exactly one promotion per freed slot
  }
}
