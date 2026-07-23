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
