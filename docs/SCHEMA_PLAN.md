# Schema Plan & Architecture

Source of truth before building `schools-api`, `passes-api`, and shared packages.

---

## Prisma Schema Changes

### `User` — add `schoolId` and `districtId`

Every user belongs to exactly one school. Nullable to allow SUPER_ADMIN users who span no specific school. SUPER_ADMINs may also be scoped to a district — if `districtId` is set they can only manage schools within that district; if null they are platform-wide with no restriction.

```prisma
model User {
  // ...existing fields...
  schoolId   String?
  districtId String?   // SUPER_ADMIN only — scopes to a district; null = platform-wide
  deletedAt  DateTime? // soft delete — deleted users cannot authenticate; set by DELETE /users/:id

  school          School?   @relation(fields: [schoolId], references: [id])
  district        District? @relation(fields: [districtId], references: [id])
  passes          Pass[]    @relation("StudentPasses")
  requestedPasses Pass[]    @relation("RequestedPasses")
  approvedPasses  Pass[]    @relation("ApprovedPasses")
  deniedPasses    Pass[]    @relation("DeniedPasses")
  cancelledPasses Pass[]    @relation("CancelledPasses")
}
```

### `District`

A named group of schools. Used to scope SUPER_ADMIN access — a SUPER_ADMIN with a `districtId` can only manage schools belonging to that district.

```prisma
model District {
  id        String    @id @default(cuid())
  name      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  schools School[]
  users   User[]
}
```

### `School`

```prisma
model School {
  id         String    @id @default(cuid())
  name       String
  timezone   String    @default("America/Los_Angeles")
  districtId String?   // optional — schools may belong to a district
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?

  district      District?
  users         User[]
  scheduleTypes ScheduleType[]
  calendar      SchoolCalendar[]
  destinations  Destination[]
  passes        Pass[]
  policy        PassPolicy?
}
```

### `PassPolicy`

One policy per school. All limits are school-wide — no per-class or per-teacher granularity since class rosters are not tracked.

```prisma
enum PolicyInterval {
  DAY
  WEEK
  MONTH
}
```

Interval boundaries (all computed in the school's timezone):
- `DAY` — current calendar day (midnight-to-midnight)
- `WEEK` — current calendar week (Monday 00:00 → Sunday 23:59, 7-day window)
- `MONTH` — current calendar month (1st 00:00 → last day 23:59)

Calendar boundaries match how schools think about limits and avoid penalizing students for passes made late the previous day or week.

```prisma
model PassPolicy {
  id              String         @id @default(cuid())
  schoolId        String         @unique

  maxActivePasses Int?            // max concurrent ACTIVE passes school-wide
  interval        PolicyInterval? // the interval window for maxPerInterval
  maxPerInterval  Int?            // max passes a student can request per interval

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  school          School         @relation(fields: [schoolId], references: [id])
}
```

`maxActivePasses` blocks approval into `WAITING`. `maxPerInterval` is a hard block — the pass is rejected at request time if the student has hit the limit within the current interval window. `interval` and `maxPerInterval` must be set together or not at all — enforced at the application layer on `PUT /schools/:schoolId/policy`; no DB-level constraint exists.

**Temporal limit counting:** counts passes in statuses `PENDING`, `WAITING`, `ACTIVE`, and `COMPLETED` within the current interval window. `CANCELLED`, `DENIED`, and `EXPIRED` are excluded — `EXPIRED` is not counted because it indicates the pass was auto-terminated by the system (e.g. student was still PENDING or WAITING when the period ended), not a real hall pass usage.

**How the limit is checked:** At pass request time, a single `COUNT(*)` query checks the student's pass count within the current interval:
```sql
SELECT COUNT(*) FROM "Pass"
WHERE "studentId" = ? AND "status" IN ('PENDING', 'WAITING', 'ACTIVE', 'COMPLETED')
  AND "createdAt" >= [intervalStart]
```
`intervalStart` is computed from the school's timezone using the interval boundaries above. The `Pass(studentId, status)` index narrows the scan to one student's passes with matching statuses; Postgres applies the `createdAt` filter as a post-scan. For a student with many `COMPLETED` passes over a long interval this scan grows, but in practice a student has at most a few passes per day making this negligible. A `(studentId, createdAt)` index would serve this query optimally if this ever becomes a bottleneck. No Redis counter is maintained — pass requests are infrequent enough that an indexed DB query is acceptable and avoids stale-counter risk.

### `ScheduleType`

Named schedule templates. A school can have multiple (e.g., "Regular", "Block A", "Block B", "Half Day"). Periods belong to a schedule type, not directly to days of the week.

```prisma
model ScheduleType {
  id        String   @id @default(cuid())
  schoolId  String
  name        String   // "Regular", "Block A", "Block B", "Half Day"
  startBuffer Int      @default(0) // minutes after period start during which passes cannot be requested
  endBuffer   Int      @default(0) // minutes before period end during which passes cannot be requested

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime? // soft delete — hard deletes are blocked at the application layer when any SchoolCalendar references the record

  school    School           @relation(fields: [schoolId], references: [id])
  periods   Period[]
  calendar  SchoolCalendar[]

  @@index([schoolId])
}
```

### `SchoolCalendar`

Every school day is explicitly assigned a schedule type. No rotation — each date is its own record. `scheduleTypeId = null` means no school that day (holiday, snow day, etc.).

```prisma
model SchoolCalendar {
  id             String        @id @default(cuid())
  schoolId       String
  date           DateTime      @db.Date
  scheduleTypeId String?       // null = no school
  note           String?       // "Snow Day", "Professional Development Day"

  school         School        @relation(fields: [schoolId], references: [id])
  scheduleType   ScheduleType? @relation(fields: [scheduleTypeId], references: [id])

  @@unique([schoolId, date])
}
```

### `Period`

Belongs to a `ScheduleType`. `startTime`/`endTime` are `"HH:MM"` strings in the school's timezone. Stored as strings intentionally — Prisma has no time-only type, and wall-clock times must remain timezone-agnostic. Format is validated at the application layer.

```prisma
model Period {
  id             String       @id @default(cuid())
  schoolId       String
  scheduleTypeId String
  name           String       // "Period 1", "Lunch", "Period 7"
  startTime      String       // "08:00" — "HH:MM", school's local timezone
  endTime        String       // "08:50" — "HH:MM", school's local timezone
  order          Int          // sort/display order

  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?    // soft delete — hard deletes are blocked at the application layer when any Pass references the record

  school         School       @relation(fields: [schoolId], references: [id])
  scheduleType   ScheduleType @relation(fields: [scheduleTypeId], references: [id])
  passes         Pass[]

  @@index([scheduleTypeId])
}
```

### `Destination`

```prisma
model Destination {
  id           String    @id @default(cuid())
  schoolId     String
  name         String    // "Bathroom - 2nd Floor", "Library", "Office"
  maxOccupancy Int?      // null = unlimited
  deletedAt    DateTime? // soft delete — matches School pattern; preserves pass history integrity

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  school       School    @relation(fields: [schoolId], references: [id])
  passes       Pass[]

  @@index([schoolId])
}
```

### `PassStatus` enum

```prisma
enum PassStatus {
  PENDING    // requested, awaiting teacher approval/denial
  WAITING    // approved but held in queue — school slot or destination at capacity
  ACTIVE     // approved + slot available — student is in the hall
  COMPLETED  // student (or teacher+) marked returned
  CANCELLED  // cancelled by student or teacher+ while PENDING or WAITING only
  DENIED     // teacher explicitly denied the request
  EXPIRED    // auto-terminated when PENDING or WAITING at period end — student never left the classroom
}
```

**Status flow:**
```
PENDING ──approve──┬─ slot open ──► ACTIVE
                   └─ slot full ─► WAITING ── slot frees ──► ACTIVE
        ──deny────► DENIED
        ──cancel──► CANCELLED
        ──period ends──► EXPIRED

ACTIVE  ──return──► COMPLETED
        ──last period ends──► COMPLETED

WAITING ──cancel──► CANCELLED
        ──period ends──► EXPIRED
```

### `Pass`

```prisma
model Pass {
  id            String     @id @default(cuid())
  schoolId      String
  studentId     String
  destinationId String
  periodId      String     // always set — pass requests are rejected before creation if no period is active
  requestedById String     // student or teacher who created the request
  approvedById  String?
  deniedById    String?
  cancelledById String?

  status        PassStatus @default(PENDING)
  note          String?

  issuedAt      DateTime?  // set when status → ACTIVE
  returnedAt    DateTime?  // set when status → COMPLETED
  expiredAt     DateTime?  // set when status → EXPIRED
  cancelledAt   DateTime?  // set when status → CANCELLED
  deniedAt      DateTime?  // set when status → DENIED

  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  school       School      @relation(fields: [schoolId], references: [id])
  student      User        @relation("StudentPasses",   fields: [studentId],     references: [id])
  requestedBy  User        @relation("RequestedPasses", fields: [requestedById], references: [id])
  approvedBy   User?       @relation("ApprovedPasses",  fields: [approvedById],  references: [id])
  deniedBy     User?       @relation("DeniedPasses",    fields: [deniedById],    references: [id])
  cancelledBy  User?       @relation("CancelledPasses", fields: [cancelledById], references: [id])
  destination  Destination @relation(fields: [destinationId], references: [id])
  period       Period      @relation(fields: [periodId], references: [id])

  @@index([schoolId, status])              // teacher board: filter by school + status
  @@index([studentId, status])             // one-pass check: student's current non-terminal pass
  @@index([schoolId, status, createdAt])   // WAITING queue: filters status = 'WAITING' within a school, ordered oldest-first
  @@index([destinationId, status, createdAt]) // WAITING promotion per destination + cold-start occupancy count
  @@index([periodId, status])              // expiry job: find all PENDING/WAITING passes for a period at period end; compound avoids post-scan status filter
}
```

`periodId` is set at request time by resolving the school's current period from `SchoolCalendar` + `Period` using the school's timezone. If no period is active, the pass request is rejected before `periodId` would be set.

---

## Index Strategy

Indexes are defined inline above on each model. Summary of rationale:

- `Pass(schoolId, status)` — every teacher query scopes to school + status
- `Pass(studentId, status)` — one-pass-at-a-time enforcement and student's own pass lookup
- `Pass(schoolId, status, createdAt)` — WAITING queue: filters `status = 'WAITING'` within a school, ordered oldest-first — `status` must be in the index to avoid a post-scan filter
- `Pass(destinationId, status, createdAt)` — WAITING promotion per destination (find oldest WAITING pass for a specific destination); also used for cold-start destination occupancy count
- `Pass(periodId, status)` — expiry job queries all PENDING/WAITING passes for a given period; compound index avoids a post-scan status filter
- `Period(scheduleTypeId)` — period lookups when resolving today's schedule
- `SchoolCalendar(schoolId, date)` — covered by the `@@unique` constraint already
- `Destination(schoolId)` — list destinations for school
- `ScheduleType(schoolId)` — list schedule types for school

The `slots:school` and `slots:destination` Redis counters avoid `COUNT(*)` queries for concurrent slot tracking at request time. The `maxPerInterval` limit is intentionally kept as a direct DB `COUNT(*)` — pass requests are infrequent enough that an indexed query is acceptable and avoids stale-counter risk. The indexes above back both the cold-start counter initialization queries and the `maxPerInterval` interval count query.

---

## Business Logic

| Action | Who |
|---|---|
| Request pass | STUDENT (self), TEACHER+ (for any student in school) |
| Approve pass | TEACHER+ |
| Deny pass | TEACHER+ |
| Mark returned (COMPLETED) | STUDENT (own), TEACHER+ |
| Cancel pass (PENDING or WAITING only) | STUDENT (own), TEACHER+ |
| Auto-expire pass | System (BullMQ) |

- A student may only have one non-terminal pass (PENDING, WAITING, ACTIVE) at a time — enforced at the API layer and backed by a DB unique partial index on `(studentId)` where `status IN ('PENDING', 'WAITING', 'ACTIVE')` as a safety net if Redis is unavailable

> **Note:** Prisma's `@@unique` does not support `WHERE` clauses. This index must be created via a raw SQL migration:
> ```sql
> CREATE UNIQUE INDEX one_active_pass_per_student
>   ON "Pass" ("studentId")
>   WHERE status IN ('PENDING', 'WAITING', 'ACTIVE');
> ```
- Pass requests are rejected if the current time falls within `startBuffer` minutes of a period starting or `endBuffer` minutes of a period ending
- If no period is currently active (between periods, after school), pass requests are rejected
- `periodId` is resolved and stored at request time; it is not recomputed after creation

---

## API Structure

### `apps/user-api`

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | authenticated | Returns `req.user` (set by `requireAuth`). Used by all clients on load. |
| GET | `/users` | TEACHER+ | Cursor-paginated (`?cursor=<lastId>&limit=50`, max 100). Filterable by `?role=`. `?ids=a,b,c` fetches specific users (replaces the former `/users/batch` endpoint, max 100). Scoping to `schoolId` is **not yet implemented** — `schoolId` does not exist in the schema. |
| POST | `/users` | ADMIN+ | Create single user. Role hierarchy enforced: cannot create a user with a role higher than your own. |
| POST | `/users/bulk` | ADMIN+ | Bulk create for school onboarding. Accepts array (max 100). Per-user role hierarchy enforced. Returns `{ created: N, failed: [{ index, email, error }] }`. HTTP 200 on partial success, 400 if all fail. |
| GET | `/users/:id` | self or TEACHER+ | Fetch single user. Returns select fields only (no `deletedAt`, `emailVerified`). |
| PATCH | `/users/:id` | self or ADMIN+ | Update name, email, or role. Self (non-admin) may only update name — email and role changes require ADMIN+. Role elevation above caller's own rank is blocked (403). `schoolId` change is **not yet implemented** — field does not exist in schema. |
| DELETE | `/users/:id` | ADMIN+ | Soft delete (sets `deletedAt`). Cannot delete a user of equal or higher rank. Self-delete is blocked. |

**Not yet implemented (pending `schoolId`/`districtId` migration):**
- `GET /users` scoping to `req.user.schoolId`
- `SUPER_ADMIN` explicit `?schoolId=` override on list endpoint (district-scoped SUPER_ADMINs further restricted to schools in their district)
- `PATCH /users/:id` restriction on `schoolId` changes to SUPER_ADMIN only
- `PATCH /users/:id` restriction on `districtId` changes to platform-wide SUPER_ADMIN only

### `apps/schools-api` — District routes

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/districts` | SUPER_ADMIN | List all districts. District-scoped SUPER_ADMINs see only their own district. |
| POST | `/districts` | SUPER_ADMIN (platform-wide only) | Create a district. |
| GET/PATCH/DELETE | `/districts/:id` | SUPER_ADMIN | District-scoped SUPER_ADMINs may only access their own district. |

### `apps/schools-api` — School routes

Covers schools, schedule types, periods, calendar, and destinations.

| Method | Route | Auth | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|---|---|---|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| GET | `/schools` | ADMIN+ |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST | `/schools` | SUPER_ADMIN |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET/PATCH/DELETE | `/schools/:id` | ADMIN+ / SUPER_ADMIN write |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET/POST | `/schools/:schoolId/schedule-types` | GET: authenticated; POST: ADMIN+ |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PATCH/DELETE | `/schools/:schoolId/schedule-types/:id` | ADMIN+ | Hard DELETE is blocked by FK if any SchoolCalendar entry references this ScheduleType. Soft DELETE is allowed — marks the type as deprecated. New calendar entries are blocked from referencing a soft-deleted type at the application layer. Existing calendar entries that reference a soft-deleted type are treated as a configuration error at schedule resolution time: log and return a 422 so the admin can reassign those dates.    |
| GET/POST | `/schools/:schoolId/schedule-types/:scheduleTypeId/periods` | GET: authenticated; POST: ADMIN+ |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PATCH/DELETE | `/schools/:schoolId/schedule-types/:scheduleTypeId/periods/:id` | ADMIN+ | If `startTime` or `endTime` changes, the BullMQ expiry job for that period was scheduled against the old time. The corrected job is upserted at the next Cloud Scheduler run (up to 12 hours away) — reschedule at time of change to get around this.                                                                                                                                                                                       |
| GET/POST | `/schools/:schoolId/calendar` | GET: authenticated; POST: ADMIN+ | POST accepts a single `CalendarEntry` or an array for bulk import. Upserts on `(schoolId, date)` — idempotent. Returns `{ created: N, updated: N }`. A full academic year is ~180 entries; bulk is required for school setup.                                                                                                                                                                                                               |
| PATCH/DELETE | `/schools/:schoolId/calendar/:id` | ADMIN+ |                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET/POST | `/schools/:schoolId/destinations` | GET: authenticated; POST: ADMIN+ | On POST, if `maxOccupancy` is set, immediately initialize `slots:destination:{destinationId}` to `maxOccupancy` — do not wait for cold start. Without this, the cap is silently bypassed until the next service restart.                                                                                                                                                                                                                    |
| PATCH/DELETE | `/schools/:schoolId/destinations/:id` | ADMIN+ | If `maxOccupancy` changes, delete and re-initialize `slots:destination:{destinationId}` using the same distributed lock pattern as cold start. If `maxOccupancy` is removed (set to null), delete the key entirely. On soft DELETE, immediately expire all WAITING passes for that destination — they will never be promoted since approvals to a deleted destination are blocked, and waiting for period-end expiry leaves students stuck. |
| GET | `/schools/:schoolId/policy` | authenticated | Returns the school's PassPolicy, or 404 if none set                                                                                                                                                                                                                                                                                                                                                                                         |
| PUT | `/schools/:schoolId/policy` | ADMIN+ | Create or replace policy (upsert on `schoolId`). On first creation or update of `maxActivePasses`, immediately initialize `slots:school:{schoolId}` — do not wait for cold start. On subsequent update, delete and re-initialize using the distributed lock pattern. If `maxActivePasses` is removed, delete the key entirely.                                                                                                              |

### `apps/passes-api`

Pass lifecycle + Socket.io real-time.

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/passes` | STUDENT (self) or TEACHER+ | Body: `{ studentId, destinationId, note? }`. For STUDENT, `studentId` is ignored — always set to `req.user.id`. For TEACHER+, `studentId` is required and must belong to the same school. Returns 201 with the created pass. Errors: 409 if student already has a non-terminal pass; 422 if no period is currently active, current time is within a buffer window, or `maxPerInterval` is exceeded. |
| GET | `/passes` | STUDENT (own) or TEACHER+ | Cursor-paginated (`?cursor=<lastId>&limit=50`). STUDENT sees only their own passes. TEACHER+ sees all passes for the school. Filterable by `?status=` and `?date=` (defaults to today). |
| GET | `/passes/:id` | STUDENT (own) or TEACHER+ | |
| POST | `/passes/:id/approve` | TEACHER+ | Returns 409 if pass is not PENDING. |
| POST | `/passes/:id/deny` | TEACHER+ | Returns 409 if pass is not PENDING. |
| POST | `/passes/:id/return` | STUDENT (own) or TEACHER+ | Returns 409 if pass is not ACTIVE. |
| POST | `/passes/:id/cancel` | STUDENT (own) or TEACHER+ | Returns 409 if pass is not PENDING or WAITING. |

---

## Redis (Upstash)

Serverless Redis — matches the Cloud Run + Neon zero-scale model.

| Key | TTL | Purpose |
|---|---|---|
| `slots:school:{schoolId}` | — | Available school-wide slots (`maxActivePasses - current ACTIVE count`) |
| `slots:destination:{destinationId}` | — | Available occupancy slots for a destination (`maxOccupancy - current ACTIVE count`). Only tracked if `maxOccupancy` is set |
| `slots:init:{schoolId}` | 30s | Distributed lock for cold-start counter initialization |
| `pass:current:{studentId}` | 24h | Plain string (`SET key passId`). Current pass ID in a non-terminal state (PENDING, WAITING, ACTIVE); enforces one-at-a-time. Deletion order: update DB → delete this key → emit Socket.io event. Deleting before emitting ensures a new pass request cannot race in between receiving the event and the key being cleared. On crash recovery, if the pass referenced by this key is already in a terminal state in DB, the API deletes the stale key and proceeds. The 24h TTL acts as a safety net so stale keys self-expire overnight even without an explicit recovery path (no school day exceeds 24h). |
| `session:{token}` | session expiry | Caches `requireAuth` DB lookup. On logout, the key is explicitly deleted so invalidated sessions are not served from cache. Without this, a logged-out session remains valid until TTL expires. |
| Socket.io adapter | — | `@socket.io/redis-adapter` for fan-out across Cloud Run instances |

**Slot counter rules:**
- Counters are decremented when a pass moves to `ACTIVE`
- Counters are incremented only when an `ACTIVE` pass reaches `COMPLETED` — `EXPIRED` only applies to `PENDING`/`WAITING` passes which never held a slot, so they never affect counters
- Counters are initialized from DB on service cold start using a distributed lock (see below)
- `slots:school` only tracked if `PassPolicy.maxActivePasses` is set; `slots:destination` only tracked if `Destination.maxOccupancy` is set

**Policy changes require counter re-sync.** If `PassPolicy.maxActivePasses` is updated mid-day, the `slots:school:{schoolId}` counter is stale. The `PUT /schools/:schoolId/policy` endpoint must delete and re-initialize `slots:school:{schoolId}` using the same distributed lock pattern as cold start. Failure to do this leaves WAITING passes stranded until next cold start. If `maxActivePasses` is removed (set to null), delete `slots:school:{schoolId}` entirely — the school no longer has a cap and the key must not linger with a stale value.

**Cold-start counter initialization (distributed lock):**

Cloud Run scales horizontally — multiple instances can cold-start simultaneously and race to initialize counters. To prevent double-counting:

1. Attempt `SET slots:init:{schoolId} 1 NX EX 30` (acquire lock)
2. If acquired: initialize counters from DB, then delete the lock key
3. If not acquired: poll every 100ms until `slots:init:{schoolId}` no longer exists, then proceed — polling on the lock key rather than a counter key because schools without `maxActivePasses` never write `slots:school`, which would cause an infinite wait. The 30s TTL guarantees the lock expires even if the holder crashes before deleting it.

This ensures exactly one instance writes counters per school per cold-start event.

**Queue promotion on slot freed:**

When any slot frees (school or destination), promote the next in line. The check-and-decrement is wrapped in a **Redis Lua script** to be fully atomic — without this, two concurrent slot-free events would both see `> 0` and double-promote (TOCTOU race):

```lua
-- Called once per WAITING candidate. Returns:
--   1  = promoted (both slots available and decremented)
--   0  = school slot exhausted — stop all promotion
--  -1  = destination slot exhausted — skip this destination, try next
-- nil means that slot type is unlimited (not tracked) — treated as always available.
local school = tonumber(redis.call('GET', KEYS[1]))  -- slots:school:{schoolId}
local dest   = tonumber(redis.call('GET', KEYS[2]))  -- slots:destination:{destinationId}
if (school == nil or school > 0) and (dest == nil or dest > 0) then
  if school ~= nil then redis.call('DECR', KEYS[1]) end
  if dest   ~= nil then redis.call('DECR', KEYS[2]) end
  return 1
end
if school ~= nil and school <= 0 then return 0 end  -- school exhausted
return -1  -- destination exhausted
```

Promotion loop (destination-grouped — prevents a full destination from starving passes going elsewhere):
1. Query all distinct `destinationId`s that have WAITING passes for this school
2. For each destination, check `slots:destination:{destinationId}` — skip if tracked and `= 0`
3. For each eligible destination, find the oldest WAITING pass (`ORDER BY createdAt ASC LIMIT 1` using `Pass(destinationId, status, createdAt)` index)
4. Execute the Lua script for that candidate:
   - Return `1`: promote (set `ACTIVE`, set `issuedAt`, emit `pass:approved`), stop
   - Return `0`: school slot exhausted (raced by concurrent promoter) — stop entirely, no point trying other destinations
   - Return `-1`: destination slot raced to 0 since step 2 — skip this destination, continue to next
5. If no destination had a promotable candidate: no-op

**Trigger:** Promotion runs as a non-blocking async call immediately after the handler responds — not a BullMQ job. The handler updates pass status and returns 200; promotion runs in the background. This keeps the response fast while promotion (typically 1–2 Lua calls) completes asynchronously.

**Crash recovery:** If the process crashes between decrementing the slot counter and completing promotion, the counter shows available slots with no corresponding ACTIVE pass. Cold-start counter initialization (which recomputes from DB) corrects this on next restart. WAITING passes are not permanently stranded — the next slot-free event retries promotion, and period-end expiry clears any remaining WAITING passes at period end.

---

## Socket.io (passes-api)

HTTP REST and WebSocket served from the same Express server.

**Auth:** Session token passed as `auth.token` in the Socket.io handshake, validated via `better-auth` before the connection is accepted.

### Rooms

| Room | Members | Purpose |
|---|---|---|
| `school:{schoolId}` | TEACHER, ADMIN, SUPER_ADMIN | Live pass board for the school |
| `user:{userId}` | STUDENT | Student's own pass status updates |

### Events

| Event | Rooms |
|---|---|
| `pass:requested` | `school:{schoolId}` |
| `pass:approved` | `school:{schoolId}`, `user:{studentId}` |
| `pass:waiting` | `school:{schoolId}`, `user:{studentId}` |
| `pass:denied` | `school:{schoolId}`, `user:{studentId}` |
| `pass:returned` | `school:{schoolId}`, `user:{studentId}` |
| `pass:cancelled` | `school:{schoolId}`, `user:{studentId}` |
| `pass:expired` | `school:{schoolId}`, `user:{studentId}` |

**Reconnection:** If a client's Socket.io connection drops and reconnects, in-flight events are not replayed. Clients must call `GET /passes/:id` (or `GET /passes?status=PENDING,WAITING,ACTIVE`) on reconnect to resync their current pass state. The REST API is the source of truth; Socket.io events are delivery-only optimizations.

---

## Pass Expiry Mechanism

Uses **BullMQ** (Redis-backed delayed job queue on the same Upstash instance — no additional infrastructure). Jobs are scheduled per-period, not per-pass.

> **TODO: Verify before building:** Upstash has historically had compatibility gaps with BullMQ (Lua scripting, stream commands). Confirm BullMQ works against Upstash instance before committing to this approach — test job scheduling, delayed execution, and retries early. If Upstash proves incompatible, alternatives are a dedicated Redis instance or replacing BullMQ with Cloud Tasks for job scheduling.

**Job scheduling:** Two Cloud Scheduler jobs fire daily — at **5am UTC** and **5pm UTC**. Each run iterates all schools, resolves each school's timezone to compute the correct wall-clock `endTime` for each period, reads that day's `SchoolCalendar` entry, and upserts one BullMQ job per period delayed until the period's absolute UTC timestamp. Jobs use a deterministic ID (e.g. `period-expiry:{schoolId}:{periodId}:{date}`) so the operation is **idempotent** — re-runs and mid-day calendar/period updates safely overwrite the existing job with no duplicates. BullMQ retries failed jobs with exponential backoff; after the retry limit is exhausted the job moves to a dead-letter queue and an alert should fire.

**Scale consideration:** At 100k schools with ~8 periods each, each scheduler run upserts up to 800k BullMQ jobs. The scheduler job must paginate schools (e.g. 1k at a time) and either process batches sequentially or fan out to parallel workers via Cloud Tasks. A single synchronous loop over all schools will exhaust memory and timeout.

**Period-end job (mid-day):**
- Bulk expire `PENDING` and `WAITING` passes for the school — no point approving or queuing when the period is over
- `ACTIVE` passes are left alone — student may still be in the hall
- No slot counters are affected and no queue promotion is triggered — `PENDING` and `WAITING` passes never held slots

**Last period-end job (end of day) — order matters:**
1. `PENDING` and `WAITING` passes → `EXPIRED` first — eliminates all queue candidates before slots are freed
2. `ACTIVE` passes → `COMPLETED` with `returnedAt = NOW()` — the student had a real pass, it just wasn't manually returned

Processing order is intentional: by expiring the queue before completing active passes, the promotion loop that runs after each slot is freed finds no `WAITING` candidates and is a no-op. This avoids promoting a pass into `ACTIVE` at end of day only to immediately expire it.

For each expired pass: update DB to `EXPIRED`, set `expiredAt`, emit `pass:expired`, no counter change (never held a slot).
For each completed pass: update DB to `COMPLETED`, set `returnedAt`, emit `pass:returned`, increment slot counter — promotion runs but finds nothing.

---

## Multi-Tenancy Convention

All users — STUDENT, TEACHER, ADMIN — are strictly scoped to their own school. Every query across every API is automatically filtered to `req.user.schoolId`. Passing a different `schoolId` in params, query, or body is ignored; the value from the authenticated user is always used.

SUPER_ADMINs are the only role exempt from school scoping. Their access is determined by `districtId`:

- **`districtId = null` (platform-wide):** No restriction — can act on any school. May pass `schoolId` explicitly on any endpoint.
- **`districtId` set (district-scoped):** Restricted to schools where `school.districtId = user.districtId`. Any explicit `schoolId` that does not belong to their district is rejected with 403.

Auth middleware applies this check automatically for all SUPER_ADMIN requests after confirming the role.

---

## Shared Packages

| Package | Purpose |
|---|---|
| `packages/types` | Shared TypeScript interfaces for request/response shapes across all APIs |
| `packages/logger` | Structured JSON logger (`pino`) shared across all APIs |

---

## Infra

| Concern | Solution |
|---|---|
| APIs | Separate Cloud Run service per API (`user-api`, `schools-api`, `passes-api`) |
| Database | Shared Neon Postgres via `@hallpass/db` |
| Connection pooling | Neon's built-in pgBouncer pooler. `DATABASE_URL` uses the **pooled connection string**; `DIRECT_URL` (unpooled) is used only for Prisma migrations. Without this, Cloud Run's horizontal scaling exhausts Postgres connection limits. |
| Cache / pubsub | Upstash Redis (one instance) |
| Pass expiry | BullMQ (Upstash Redis) — per-period jobs scheduled daily via Cloud Scheduler |
