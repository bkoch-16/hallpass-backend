import { describe, it, expect } from "vitest";
import {
  createUserSchema,
  updateUserSchema,
  listUsersSchema,
  bulkCreateSchema,
  userIdSchema,
} from "../../src/schemas/user";

describe("createUserSchema", () => {
  it("accepts valid email and name", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com", name: "Alice" });
    expect(r.success).toBe(true);
  });

  it("accepts valid role", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com", name: "Alice", role: "ADMIN" });
    expect(r.success).toBe(true);
    expect(r.data?.role).toBe("ADMIN");
  });

  it("role is optional (undefined when omitted)", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com", name: "Alice" });
    expect(r.success).toBe(true);
    expect(r.data?.role).toBeUndefined();
  });

  it("rejects missing email", () => {
    const r = createUserSchema.safeParse({ name: "Alice" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const r = createUserSchema.safeParse({ email: "not-an-email", name: "Alice" });
    expect(r.success).toBe(false);
  });

  it("rejects missing name", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com" });
    expect(r.success).toBe(false);
  });

  it("rejects empty name", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com", name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid role enum value", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com", name: "Alice", role: "mega_admin" });
    expect(r.success).toBe(false);
  });

  it("strips unknown fields", () => {
    const r = createUserSchema.safeParse({ email: "a@b.com", name: "Alice", unknown: "x" });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("unknown");
  });
});

describe("updateUserSchema", () => {
  it("accepts name-only update", () => {
    const r = updateUserSchema.safeParse({ name: "Bob" });
    expect(r.success).toBe(true);
  });

  it("accepts email-only update", () => {
    const r = updateUserSchema.safeParse({ email: "b@b.com" });
    expect(r.success).toBe(true);
  });

  it("accepts role-only update", () => {
    const r = updateUserSchema.safeParse({ role: "TEACHER" });
    expect(r.success).toBe(true);
  });

  it("accepts all fields together", () => {
    const r = updateUserSchema.safeParse({ name: "Bob", email: "b@b.com", role: "ADMIN" });
    expect(r.success).toBe(true);
  });

  it("rejects empty object (at least one field required)", () => {
    const r = updateUserSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const r = updateUserSchema.safeParse({ email: "bad" });
    expect(r.success).toBe(false);
  });

  it("rejects empty name", () => {
    const r = updateUserSchema.safeParse({ name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid role enum value", () => {
    const r = updateUserSchema.safeParse({ role: "GOD" });
    expect(r.success).toBe(false);
  });

  it("accepts schoolId as a valid positive integer", () => {
    const r = updateUserSchema.safeParse({ schoolId: 1 });
    expect(r.success).toBe(true);
  });

  it("accepts schoolId as null", () => {
    const r = updateUserSchema.safeParse({ schoolId: null });
    expect(r.success).toBe(true);
  });

  it("rejects schoolId with invalid format (non-integer string)", () => {
    const r = updateUserSchema.safeParse({ schoolId: "school-1" });
    expect(r.success).toBe(false);
  });

  it("schoolId alone satisfies the at-least-one-field requirement", () => {
    const r = updateUserSchema.safeParse({ schoolId: 1 });
    expect(r.success).toBe(true);
  });

});

describe("listUsersSchema", () => {
  it("accepts empty query (all fields optional)", () => {
    const r = listUsersSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts valid role filter", () => {
    const r = listUsersSchema.safeParse({ role: "STUDENT" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid role value", () => {
    const r = listUsersSchema.safeParse({ role: "MEGA_ADMIN" });
    expect(r.success).toBe(false);
  });

  it("coerces limit string to number", () => {
    const r = listUsersSchema.safeParse({ limit: "25" });
    expect(r.success).toBe(true);
    expect(r.data?.limit).toBe(25);
  });

  it("rejects limit above 100", () => {
    const r = listUsersSchema.safeParse({ limit: "101" });
    expect(r.success).toBe(false);
  });

  it("rejects limit of 0", () => {
    const r = listUsersSchema.safeParse({ limit: "0" });
    expect(r.success).toBe(false);
  });

  it("defaults limit to 50 when omitted", () => {
    const r = listUsersSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.limit).toBe(50);
  });

  it("accepts cursor and ids as strings", () => {
    const r = listUsersSchema.safeParse({ cursor: "some-id", ids: "a,b,c" });
    expect(r.success).toBe(true);
  });
});

describe("bulkCreateSchema", () => {
  it("accepts array of valid users", () => {
    const r = bulkCreateSchema.safeParse([
      { email: "a@b.com", name: "Alice" },
      { email: "b@b.com", name: "Bob", role: "TEACHER" },
    ]);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
  });

  it("rejects empty array", () => {
    const r = bulkCreateSchema.safeParse([]);
    expect(r.success).toBe(false);
  });

  it("rejects array with more than 100 users", () => {
    const users = Array.from({ length: 101 }, (_, i) => ({
      email: `user${i}@b.com`,
      name: `User ${i}`,
    }));
    const r = bulkCreateSchema.safeParse(users);
    expect(r.success).toBe(false);
  });

  it("rejects array containing an invalid user", () => {
    const r = bulkCreateSchema.safeParse([
      { email: "a@b.com", name: "Alice" },
      { email: "not-an-email", name: "Bob" },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects non-array input", () => {
    const r = bulkCreateSchema.safeParse({ email: "a@b.com", name: "Alice" });
    expect(r.success).toBe(false);
  });
});

describe("userIdSchema", () => {
  it("accepts valid numeric id", () => {
    const r = userIdSchema.safeParse({ id: "123" });
    expect(r.success).toBe(true);
  });

  it("rejects non-numeric id", () => {
    const r = userIdSchema.safeParse({ id: "user-123" });
    expect(r.success).toBe(false);
  });

  it("rejects empty id", () => {
    const r = userIdSchema.safeParse({ id: "" });
    expect(r.success).toBe(false);
  });

  it("rejects missing id", () => {
    const r = userIdSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
