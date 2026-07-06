import { prisma, PassStatus, type Prisma } from "@hallpass/db";
import { redis } from "./redis.js";
import { emitPassEvent } from "./socket.js";

const SLOT_TTL_SECONDS = 86400;

const PROMOTE_BATCH_SIZE = 100;

function slotKey(destinationId: number): string {
  return `slots:destination:${destinationId}`;
}

function schoolSlotKey(schoolId: number): string {
  return `slots:school:${schoolId}`;
}

// Shared Lua helpers: claim/release one counter key, where max == -1 means
// "unlimited — skip this key entirely".
//
// claim: atomically initialise if missing, decrement, and restore if
// over-claimed. Returns 1 when claimed (or unlimited), 0 when full.
//
// release: atomically increment then cap at max.
const LUA_SLOT_HELPERS = `
local function claim(key, max)
  if max == -1 then return 1 end
  if redis.call('EXISTS', key) == 0 then
    redis.call('SET', key, max, 'EX', ${SLOT_TTL_SECONDS})
  end
  local remaining = redis.call('DECR', key)
  if remaining < 0 then
    redis.call('INCR', key)
    return 0
  end
  redis.call('EXPIRE', key, ${SLOT_TTL_SECONDS})
  return 1
end
local function release(key, max)
  if max == -1 then return end
  local val = redis.call('INCR', key)
  if val > max then
    redis.call('SET', key, max, 'EX', ${SLOT_TTL_SECONDS})
    return
  end
  redis.call('EXPIRE', key, ${SLOT_TTL_SECONDS})
end
`;

// Claim the destination slot (KEYS[1]/ARGV[1]) and the school-wide slot
// (KEYS[2]/ARGV[2]) in one round trip. On school failure the destination
// claim is rolled back atomically. Returns 1 = both claimed,
// 0 = destination full, -1 = school cap exhausted.
const LUA_CLAIM_PASS_SLOTS = `${LUA_SLOT_HELPERS}
local destMax = tonumber(ARGV[1])
local schoolMax = tonumber(ARGV[2])
if claim(KEYS[1], destMax) == 0 then return 0 end
if claim(KEYS[2], schoolMax) == 0 then
  release(KEYS[1], destMax)
  return -1
end
return 1
`;

// Release the destination slot (KEYS[1]/ARGV[1]) and the school-wide slot
// (KEYS[2]/ARGV[2]) in one round trip.
const LUA_RELEASE_PASS_SLOTS = `${LUA_SLOT_HELPERS}
release(KEYS[1], tonumber(ARGV[1]))
release(KEYS[2], tonumber(ARGV[2]))
return 1
`;

export type ClaimResult = "claimed" | "destination_full" | "school_full";

/** Look up the school's maxActivePasses policy (null = unlimited). */
export async function getMaxActivePasses(schoolId: number): Promise<number | null> {
  const policy = await prisma.passPolicy.findFirst({
    where: { schoolId },
    select: { maxActivePasses: true },
  });
  return policy?.maxActivePasses ?? null;
}

/**
 * Claim one destination slot AND one school-wide slot in a single atomic
 * Lua round trip; on partial claim the destination slot is rolled back
 * inside the script before returning.
 * - A null max → unlimited for that counter (skipped in the script).
 * - A zero max → never allow, fail before touching Redis (avoids a Redis
 *   TTL-expiry race where the restore INCR could create a key at 1).
 */
export async function claimPassSlots(
  schoolId: number,
  maxActivePasses: number | null,
  destinationId: number,
  maxOccupancy: number | null,
): Promise<ClaimResult> {
  if (maxOccupancy === 0) return "destination_full";
  if (maxActivePasses === 0) return "school_full";
  if (maxOccupancy === null && maxActivePasses === null) return "claimed";
  const result = (await redis.eval(
    LUA_CLAIM_PASS_SLOTS,
    2,
    slotKey(destinationId),
    schoolSlotKey(schoolId),
    maxOccupancy ?? -1,
    maxActivePasses ?? -1,
  )) as number;
  if (result === 0) return "destination_full";
  if (result === -1) return "school_full";
  return "claimed";
}

/** Release one destination slot AND one school-wide slot in a single round trip. */
export async function releasePassSlots(
  schoolId: number,
  maxActivePasses: number | null,
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  if (maxOccupancy === null && maxActivePasses === null) return;
  await redis.eval(
    LUA_RELEASE_PASS_SLOTS,
    2,
    slotKey(destinationId),
    schoolSlotKey(schoolId),
    maxOccupancy ?? -1,
    maxActivePasses ?? -1,
  );
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
 * Reconcile a Redis counter against actual DB state.
 * SET counter = max - (# ACTIVE passes matching `where`).
 * No-op when max is null.
 */
async function reconcileKey(
  key: string,
  max: number | null,
  where: Prisma.PassWhereInput,
): Promise<void> {
  if (max === null) return;

  const activeCount = await prisma.pass.count({
    where: { ...where, status: PassStatus.ACTIVE },
  });

  await redis.set(key, Math.max(0, max - activeCount), "EX", SLOT_TTL_SECONDS);
}

/** Reconcile a destination counter: maxOccupancy - (# ACTIVE passes there). */
export async function reconcileSlots(
  destinationId: number,
  maxOccupancy: number | null,
): Promise<void> {
  return reconcileKey(slotKey(destinationId), maxOccupancy, { destinationId });
}

/** Reconcile a school-wide counter: maxActivePasses - (# ACTIVE passes in school). */
export async function reconcileSchoolSlots(
  schoolId: number,
  maxActivePasses: number | null,
): Promise<void> {
  return reconcileKey(schoolSlotKey(schoolId), maxActivePasses, { schoolId });
}

/**
 * Promote at most one WAITING pass for the school, oldest-first grouped by
 * destination (a full destination must not starve passes headed elsewhere —
 * SCHEMA_PLAN "Queue promotion on slot freed"). Claims BOTH the destination
 * and school counters; if the school cap is exhausted, promotion stops entirely.
 * Uses updateMany with a status guard to be safe under concurrent promotions.
 * WAITING passes are fetched in batches so a deep queue is never fully loaded.
 */
export async function promoteFromQueue(
  schoolId: number,
  maxActivePasses: number | null,
): Promise<void> {
  const triedDestinations = new Set<number>();
  let cursor: number | undefined;

  while (true) {
    const waiting = await prisma.pass.findMany({
      where: { schoolId, status: PassStatus.WAITING },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      include: { destination: { select: { maxOccupancy: true } } },
      take: PROMOTE_BATCH_SIZE,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (waiting.length === 0) return;

    for (const candidate of waiting) {
      // Only the oldest WAITING pass per destination is promotable (FIFO per destination)
      if (triedDestinations.has(candidate.destinationId)) continue;
      triedDestinations.add(candidate.destinationId);

      const maxOccupancy = candidate.destination.maxOccupancy;
      const claim = await claimPassSlots(
        schoolId,
        maxActivePasses,
        candidate.destinationId,
        maxOccupancy,
      );
      if (claim === "destination_full") continue; // try the next destination
      if (claim === "school_full") return; // nothing in this school can be promoted

      const { count } = await prisma.pass.updateMany({
        where: { id: candidate.id, status: PassStatus.WAITING },
        data: { status: PassStatus.ACTIVE, activatedAt: new Date() },
      });

      if (count === 0) {
        // Another worker already promoted this pass — give back both slots.
        // The raced pass is no longer WAITING, so un-mark its destination:
        // the next-oldest WAITING pass for that destination is now the FIFO
        // head and must stay eligible for this loop.
        await releasePassSlots(schoolId, maxActivePasses, candidate.destinationId, maxOccupancy);
        triedDestinations.delete(candidate.destinationId);
        continue;
      }

      const promoted = await prisma.pass.findUniqueOrThrow({ where: { id: candidate.id } });
      // Same event as a direct approval — SCHEMA_PLAN defines no separate promotion event
      emitPassEvent(promoted, "pass:approved");
      return; // exactly one promotion per freed slot
    }

    if (waiting.length < PROMOTE_BATCH_SIZE) return;
    cursor = waiting[waiting.length - 1]!.id;
  }
}
