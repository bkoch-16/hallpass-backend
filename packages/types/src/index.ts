import type { UserRole, PassStatus, PolicyInterval } from "./enums.js";

// ─── Enums ───────────────────────────────────────────────────────────────────

export * from "./enums.js";

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface DistrictResponse {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserResponse {
  id: number;
  name: string | null;
  email: string;
  role: UserRole;
  schoolId: number | null;
  createdAt: Date;
  // Only present when the caller is ADMIN+ reading a single STUDENT via
  // GET /users/:id — never on list, self, or TEACHER reads.
  pinCode?: string | null;
}

export interface ProvisionUserResponse extends UserResponse {
  tempPassword: string;
}

export interface SchoolResponse {
  id: number;
  name: string;
  timezone: string;
  districtId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeResponse extends UserResponse {
  school: Pick<SchoolResponse, "id" | "name" | "timezone"> | null;
}

export interface PassPolicyResponse {
  id: number;
  schoolId: number;
  maxActivePasses: number | null;
  interval: PolicyInterval | null;
  maxPerInterval: number | null;
}

export interface ScheduleTypeResponse {
  id: number;
  schoolId: number;
  name: string;
  startBuffer: number;
  endBuffer: number;
}

export interface PeriodResponse {
  id: number;
  scheduleTypeId: number;
  name: string;
  startTime: string;
  endTime: string;
  order: number;
}

export interface SchoolCalendarResponse {
  id: number;
  schoolId: number;
  date: Date;
  scheduleTypeId: number | null;
  note: string | null;
}

export interface PeriodWindowResponse extends PeriodResponse {
  windowStart: string;
  windowEnd: string;
}

export interface ScheduleTodayResponse {
  date: string; // school-local "YYYY-MM-DD"
  scheduleType: ScheduleTypeResponse | null;
  periods: PeriodWindowResponse[];
  currentPeriod: PeriodWindowResponse | null;
}

export interface DestinationResponse {
  id: number;
  schoolId: number;
  name: string;
  maxOccupancy: number | null;
}

export interface PassResponse {
  id: number;
  schoolId: number;
  studentId: number;
  studentName: string | null;
  requesterId: number;
  requesterName: string | null;
  destinationId: number;
  destinationName: string;
  periodId: number | null;
  approverId: number | null;
  approverName: string | null;
  denierId: number | null;
  denierName: string | null;
  cancellerId: number | null;
  cancellerName: string | null;
  status: PassStatus;
  note: string | null;
  approverNote: string | null;
  denierNote: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  activatedAt: Date | null;
  returnedAt: Date | null;
  cancelledAt: Date | null;
  deniedAt: Date | null;
  expiredAt: Date | null;
}

export interface ParentLookupPass {
  id: number;
  destination: string;
  status: PassStatus;
  requestedAt: Date;
  activatedAt: Date | null;
  returnedAt: Date | null;
  durationMinutes: number | null;
}

export interface ParentLookupResponse {
  student: { id: number; name: string | null };
  passes: ParentLookupPass[];
  nextCursor: string | null;
}

// ─── Request bodies ───────────────────────────────────────────────────────────

// CreateSchoolBody/UpdateSchoolBody, CalendarEntryBody, and
// CreateUserBody/UpdateUserBody are derived via z.infer from the Zod schemas
// in ./schemas.js (also re-exported here so apps can use the same schema
// instances for validateBody()) — the hand-written interfaces that used to
// live here for these could drift from the validators actually enforced at
// runtime (and did: UpdateSchoolBody.districtId was non-nullable even though
// the schema accepts null to clear it).
export * from "./schemas.js";

export interface CreateDistrictBody {
  name: string;
}

export interface UpdateDistrictBody {
  name?: string;
}

export interface CreateScheduleTypeBody {
  name: string;
  startBuffer?: number;
  endBuffer?: number;
}

export interface UpdateScheduleTypeBody {
  name?: string;
  startBuffer?: number;
  endBuffer?: number;
}

export interface CreatePeriodBody {
  name: string;
  startTime: string;
  endTime: string;
  order: number;
}

export interface UpdatePeriodBody {
  name?: string;
  startTime?: string;
  endTime?: string;
  order?: number;
}

export interface CreateDestinationBody {
  name: string;
  maxOccupancy?: number | null;
}

export interface UpdateDestinationBody {
  name?: string;
  maxOccupancy?: number | null;
}

export interface UpsertPassPolicyBody {
  maxActivePasses?: number | null;
  interval?: PolicyInterval | null;
  maxPerInterval?: number | null;
}

export interface CreatePassBody {
  studentId?: number; // ignored for STUDENT role; required for TEACHER+
  destinationId: number;
  note?: string;
}

// ─── Bulk operation results ───────────────────────────────────────────────────

export interface BulkUpsertResult {
  created: number;
  updated: number;
}

export interface BulkUserFailure {
  index: number;
  email: string;
  error: string;
}

export interface BulkUserResult {
  created: number;
  failed: BulkUserFailure[];
}
