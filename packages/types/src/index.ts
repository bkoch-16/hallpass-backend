// ─── Enums ───────────────────────────────────────────────────────────────────

export const UserRole = {
  STUDENT: "STUDENT",
  TEACHER: "TEACHER",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
  SERVICE: "SERVICE",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// Roles that can be assigned to users via the API (excludes SERVICE)
export const ASSIGNABLE_ROLES = ["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PassStatus = {
  PENDING: "PENDING",
  WAITING: "WAITING",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  DENIED: "DENIED",
  EXPIRED: "EXPIRED",
} as const;

export type PassStatus = (typeof PassStatus)[keyof typeof PassStatus];

export const PolicyInterval = {
  DAY: "DAY",
  WEEK: "WEEK",
  MONTH: "MONTH",
} as const;

export type PolicyInterval = (typeof PolicyInterval)[keyof typeof PolicyInterval];

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
}

export interface SchoolResponse {
  id: number;
  name: string;
  timezone: string;
  districtId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PassPolicyResponse {
  id: string;
  schoolId: number;
  maxActivePasses: number | null;
  interval: PolicyInterval | null;
  maxPerInterval: number | null;
}

export interface ScheduleTypeResponse {
  id: string;
  schoolId: number;
  name: string;
  startBuffer: number;
  endBuffer: number;
}

export interface PeriodResponse {
  id: string;
  scheduleTypeId: string;
  name: string;
  startTime: string;
  endTime: string;
  order: number;
}

export interface SchoolCalendarResponse {
  id: string;
  schoolId: number;
  date: Date;
  scheduleTypeId: string | null;
  note: string | null;
}

export interface DestinationResponse {
  id: string;
  schoolId: number;
  name: string;
  maxOccupancy: number | null;
}

export interface PassResponse {
  id: string;
  schoolId: number;
  studentId: string;
  destinationId: string;
  periodId: string;
  requestedById: string;
  approvedById: string | null;
  deniedById: string | null;
  cancelledById: string | null;
  status: PassStatus;
  note: string | null;
  issuedAt: Date | null;
  returnedAt: Date | null;
  expiredAt: Date | null;
  cancelledAt: Date | null;
  deniedAt: Date | null;
  createdAt: Date;
}

// ─── Request bodies ───────────────────────────────────────────────────────────

export interface CreateDistrictBody {
  name: string;
}

export interface UpdateDistrictBody {
  name?: string;
}

export interface CreateSchoolBody {
  name: string;
  timezone?: string;
  districtId?: number;
}

export interface UpdateSchoolBody {
  name?: string;
  timezone?: string;
  districtId?: number;
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

export interface CalendarEntryBody {
  date: string; // "YYYY-MM-DD"
  scheduleTypeId?: string | null;
  note?: string | null;
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
  studentId?: string; // ignored for STUDENT role; required for TEACHER+
  destinationId: string;
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
