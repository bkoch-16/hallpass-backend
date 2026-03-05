# Schema Plan & Architecture

Source of truth before building `schools-api`, `passes-api`, and shared packages.

---

## Prisma Schema Changes

### `User` — add `schoolId`

Every user belongs to exactly one school. Nullable to allow SUPER_ADMIN users who span no specific school.

```prisma
model User {
  // ...existing fields...
  schoolId  String?

  school          School?  @relation(fields: [schoolId], references: [id])
  passes          Pass[]   @relation("StudentPasses")
  requestedPasses Pass[]   @relation("RequestedPasses")
  approvedPasses  Pass[]   @relation("ApprovedPasses")
  deniedPasses    Pass[]   @relation("DeniedPasses")
  cancelledPasses Pass[]   @relation("CancelledPasses")
}
```

### `School`

```prisma
model School {
  id        String    @id @default(cuid())
  name      String
  timezone  String    @default("America/Los_Angeles")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

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

model PassPolicy {
  id              String         @id @default(cuid())
  schoolId        String         @unique

  maxActivePasses Int?            // max concurrent ACTIVE passes school-wide
  interval        PolicyInterval? // the rolling window for maxPerInterval
  maxPerInterval  Int?            // max passes a student can request per interval

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  school          School         @relation(fields: [schoolId], references: [id])
}
```

`maxActivePasses` blocks approval into `WAITING`. `maxPerInterval` is a hard block — the pass is rejected at request time if the student has hit the limit within the current rolling window. `interval` and `maxPerInterval` must be set together or not at all.

**Temporal limit counting:** counts passes in statuses `PENDING`, `WAITING`, `ACTIVE`, and `COMPLETED` within the rolling window. `CANCELLED`, `DENIED`, and `EXPIRED` are excluded — `EXPIRED` is not counted because it indicates the pass was auto-terminated by the system (e.g. student was still PENDING or WAITING when the period ended), not a real hall pass usage.

### `ScheduleType`

Named schedule templates. A school can have multiple (e.g., "Regular", "Block A", "Block B", "Half Day"). Periods belong to a schedule type, not directly to days of the week.

```prisma
model ScheduleType {
  id        String   @id @default(cuid())
  schoolId  String
  name        String   // "Regular", "Block A", "Block B", "Half Day"
  startBuffer Int      @default(0) // minutes after period start during which passes cannot be requested
  endBuffer   Int      @default(0) // minutes before period end during which passes cannot be requested

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  school    School           @relation(fields: [schoolId], references: [id])
  periods   Period[]
  calendar  SchoolCalendar[]
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
  periodId      String?    // period active at request time; used for audit and expiry targeting
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
  period       Period?     @relation(fields: [periodId], references: [id])

  @@index([schoolId, status])     // teacher board: filter by school + status
  @@index([studentId, status])    // one-pass check: student's current non-terminal pass
  @@index([schoolId, createdAt])  // WAITING queue: oldest-first promotion ordering
  @@index([destinationId, status]) // destination occupancy count on cold start
}
```

`periodId` is set at request time by resolving the school's current period from `SchoolCalendar` + `Period` using the school's timezone. If no period is active, the pass request is rejected before `periodId` would be set.

---

## Index Strategy

Indexes are defined inline above on each model. Summary of rationale:

- `Pass(schoolId, status)` — every teacher query scopes to school + status
- `Pass(studentId, status)` — one-pass-at-a-time enforcement and student's own pass lookup
- `Pass(schoolId, createdAt)` — WAITING queue is ordered oldest-first within a school
- `Pass(destinationId, status)` — destination occupancy count during cold-start counter initialization
- `Period(scheduleTypeId)` — period lookups when resolving today's schedule
- `SchoolCalendar(schoolId, date)` — covered by the `@@unique` constraint already

The `slots:school` and `slots:destination` Redis counters exist specifically to avoid `COUNT(*)` queries on `Pass` at request time. The indexes above back the DB queries used only during cold-start initialization of those counters.

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
- Pass requests are rejected if the current time falls within `startBuffer` minutes of a period starting or `endBuffer` minutes of a period ending
- If no period is currently active (between periods, after school), pass requests are rejected
- `periodId` is resolved and stored at request time; it is not recomputed after creation

---

## API Structure

### `apps/user-api`

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | authenticated | Returns own profile. Used by all clients on load. |
| GET | `/users` | authenticated | Lists users scoped to `req.user.schoolId`. Filterable by `?role=`. Cursor-paginated (`?cursor=<lastId>&limit=50`). Teachers use this to search students when creating a pass on their behalf. SUPER_ADMIN may pass explicit `?schoolId=`. Do not use offset pagination — it degrades at scale. |
| POST | `/users` | ADMIN+ | Create single user. |
| POST | `/users/bulk` | ADMIN+ | Bulk create users for school onboarding. Accepts array. Returns `{ created: N, failed: [...] }`. |
| GET | `/users/:id` | self or TEACHER+ | Fetch single user. |
| PATCH | `/users/:id` | self or ADMIN+ | Update user. |
| DELETE | `/users/:id` | ADMIN+ | Soft delete. |

### `apps/schools-api`

Covers schools, schedule types, periods, calendar, and destinations.

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/schools` | ADMIN+ | |
| POST | `/schools` | SUPER_ADMIN | |
| GET/PATCH/DELETE | `/schools/:id` | ADMIN+ / SUPER_ADMIN write | |
| GET/POST | `/schools/:schoolId/schedule-types` | GET: authenticated; POST: ADMIN+ | |
| PATCH/DELETE | `/schools/:schoolId/schedule-types/:id` | ADMIN+ | |
| GET/POST | `/schools/:schoolId/schedule-types/:scheduleTypeId/periods` | GET: authenticated; POST: ADMIN+ | |
| PATCH/DELETE | `/schools/:schoolId/schedule-types/:scheduleTypeId/periods/:id` | ADMIN+ | |
| GET/POST | `/schools/:schoolId/calendar` | GET: authenticated; POST: ADMIN+ | POST accepts a single `CalendarEntry` or an array for bulk import. Upserts on `(schoolId, date)` — idempotent. Returns `{ created: N, updated: N }`. A full academic year is ~180 entries; bulk is required for school setup. |
| PATCH/DELETE | `/schools/:schoolId/calendar/:id` | ADMIN+ | |
| GET/POST | `/schools/:schoolId/destinations` | GET: authenticated; POST: ADMIN+ | |
| PATCH/DELETE | `/schools/:schoolId/destinations/:id` | ADMIN+ | |

### `apps/passes-api`

Pass lifecycle + Socket.io real-time.

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/passes` | STUDENT (self) or TEACHER+ | |
| GET | `/passes` | STUDENT (own) or TEACHER+ | Cursor-paginated (`?cursor=<lastId>&limit=50`). STUDENT sees only their own passes. TEACHER+ sees all passes for the school. Filterable by `?status=` and `?date=` (defaults to today). |
| GET | `/passes/:id` | STUDENT (own) or TEACHER+ | |
| POST | `/passes/:id/approve` | TEACHER+ | |
| POST | `/passes/:id/deny` | TEACHER+ | |
| POST | `/passes/:id/return` | STUDENT (own) or TEACHER+ | |
| POST | `/passes/:id/cancel` | STUDENT (own) or TEACHER+ | |

---

## Redis (Upstash)

Serverless Redis — matches the Cloud Run + Neon zero-scale model.

| Key | TTL | Purpose |
|---|---|---|
| `slots:school:{schoolId}` | — | Available school-wide slots (`maxActivePasses - current ACTIVE count`) |
| `slots:destination:{destinationId}` | — | Available occupancy slots for a destination (`maxOccupancy - current ACTIVE count`). Only tracked if `maxOccupancy` is set |
| `slots:init:{schoolId}` | 30s | Distributed lock for cold-start counter initialization |
| `pass:current:{studentId}` | — | Plain string (`SET key passId`). Current pass ID in a non-terminal state (PENDING, WAITING, ACTIVE); enforces one-at-a-time. Deleted after the terminal Socket.io event is emitted. |
| `session:{token}` | session expiry | Caches `requireAuth` DB lookup |
| Socket.io adapter | — | `@socket.io/redis-adapter` for fan-out across Cloud Run instances |

**Slot counter rules:**
- Counters are decremented when a pass moves to `ACTIVE`
- Counters are incremented only when an `ACTIVE` pass reaches `COMPLETED` — `EXPIRED` only applies to `PENDING`/`WAITING` passes which never held a slot, so they never affect counters
- Counters are initialized from DB on service cold start using a distributed lock (see below)
- `slots:school` only tracked if `PassPolicy.maxActivePasses` is set; `slots:destination` only tracked if `Destination.maxOccupancy` is set

**Cold-start counter initialization (distributed lock):**

Cloud Run scales horizontally — multiple instances can cold-start simultaneously and race to initialize counters. To prevent double-counting:

1. Attempt `SET slots:init:{schoolId} 1 NX EX 30` (acquire lock)
2. If acquired: initialize counters from DB, then delete the lock key
3. If not acquired: poll until `slots:init:{schoolId}` no longer exists, then proceed — polling on the lock key rather than a counter key because schools without `maxActivePasses` never write `slots:school`, which would cause an infinite wait

This ensures exactly one instance writes counters per school per cold-start event.

**Queue promotion on slot freed:**

When any slot frees (school or destination), promote the next in line. The check-and-decrement is wrapped in a **Redis Lua script** to be fully atomic — without this, two concurrent slot-free events would both see `> 0` and double-promote (TOCTOU race):

```lua
-- Called once per WAITING candidate, oldest first. Returns 1 if promoted, 0 if not.
local school = tonumber(redis.call('GET', KEYS[1]))  -- slots:school:{schoolId}
local dest   = tonumber(redis.call('GET', KEYS[2]))  -- slots:destination:{destinationId}
if school > 0 and dest > 0 then
  redis.call('DECR', KEYS[1])
  redis.call('DECR', KEYS[2])
  return 1
end
return 0
```

Promotion loop:
1. Query `WAITING` passes for that school ordered by `createdAt ASC` — oldest first
2. For each candidate, execute the Lua script with its school and destination keys
3. On return `1`: set status to `ACTIVE`, set `issuedAt`, emit `pass:approved` — stop
4. On return `0`: try next candidate

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

---

## Pass Expiry Mechanism

Uses **BullMQ** (Redis-backed delayed job queue on the same Upstash instance — no additional infrastructure). Jobs are scheduled per-period, not per-pass.

**Job scheduling:** Two Cloud Scheduler jobs fire daily — at **5am UTC** and **5pm UTC**. Each run iterates all schools, resolves each school's timezone to compute the correct wall-clock `endTime` for each period, reads that day's `SchoolCalendar` entry, and upserts one BullMQ job per period delayed until the period's absolute UTC timestamp. Jobs use a deterministic ID (e.g. `period-expiry:{schoolId}:{periodId}:{date}`) so the operation is **idempotent** — re-runs and mid-day calendar/period updates safely overwrite the existing job with no duplicates.

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

SUPER_ADMINs are the only role exempt from this — they may pass `schoolId` explicitly to act across schools.

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
