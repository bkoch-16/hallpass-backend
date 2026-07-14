/**
 * Integration tests for the planned `createUserWithCredential` helper.
 *
 * This helper provisions a User plus a better-auth credential Account in one
 * step so the user can immediately sign in with the given password — replacing
 * the hand-rolled scrypt landmine in packages/db/prisma/seed.ts.
 *
 * These tests are RED until `createUserWithCredential` and `EmailInUseError`
 * are exported from @hallpass/auth.
 *
 * Run with: pnpm --filter @hallpass/user-api test:integration
 * Requires: docker-compose up -d (PostgreSQL on localhost:5432)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "@hallpass/db";
import { createUserWithCredential, EmailInUseError } from "@hallpass/auth";
import { auth } from "../../src/auth.js";

beforeEach(async () => {
  // Sessions and accounts are cascade-deleted with users.
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.$disconnect();
});

describe("createUserWithCredential (integration)", () => {
  it("creates a User and a better-auth credential Account", async () => {
    const user = await createUserWithCredential(auth, {
      email: "provisioned@test.com",
      password: "password123",
      name: "Provisioned User",
    });

    expect(Number.isInteger(user.id)).toBe(true);
    expect(user.id).toBeGreaterThan(0);

    const dbUser = await prisma.user.findUnique({ where: { email: "provisioned@test.com" } });
    expect(dbUser).not.toBeNull();

    const account = await prisma.account.findFirst({
      where: { userId: dbUser!.id, providerId: "credential" },
    });
    expect(account).not.toBeNull();
    expect(account!.password).toBeTruthy();
  });

  it("provisioned user can subsequently SIGN IN and reach GET /api/users/me", async () => {
    await createUserWithCredential(auth, {
      email: "signinable@test.com",
      password: "password123",
      name: "Sign Inable",
    });

    const agent = request.agent(app);

    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .send({ email: "signinable@test.com", password: "password123" });

    expect(signIn.status).toBe(200);

    const me = await agent.get("/api/users/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("signinable@test.com");
    expect(Number.isInteger(me.body.id)).toBe(true);
    expect(me.body.id).toBeGreaterThan(0);
  });

  it("persists role and schoolId at creation (no default-STUDENT-then-patch)", async () => {
    const school = await prisma.school.create({ data: { name: "Test High School" } });

    const user = await createUserWithCredential(auth, {
      email: "teacher@test.com",
      password: "password123",
      name: "Teacher User",
      role: "TEACHER",
      schoolId: school.id,
    });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser!.role).toBe("TEACHER");
    expect(dbUser!.schoolId).toBe(school.id);
  });

  it("lowercases the email", async () => {
    const user = await createUserWithCredential(auth, {
      email: "MixedCase@Test.com",
      password: "password123",
      name: "Mixed Case",
    });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser!.email).toBe("mixedcase@test.com");
  });

  it("throws a typed EmailInUseError on duplicate email (callers map to 409)", async () => {
    await createUserWithCredential(auth, {
      email: "dup@test.com",
      password: "password123",
      name: "First",
    });

    await expect(
      createUserWithCredential(auth, {
        email: "dup@test.com",
        password: "password123",
        name: "Second",
      }),
    ).rejects.toBeInstanceOf(EmailInUseError);

    // Exactly one user — the duplicate attempt was rejected, not synthesized as success.
    const count = await prisma.user.count({ where: { email: "dup@test.com" } });
    expect(count).toBe(1);
  });

  it("throws EmailInUseError (not a raw Prisma error) when two calls race on the same email", async () => {
    const attempt = (name: string) =>
      createUserWithCredential(auth, {
        email: "racing@test.com",
        password: "password123",
        name,
      });

    const results = await Promise.allSettled([attempt("First"), attempt("Second")]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(EmailInUseError);

    const count = await prisma.user.count({ where: { email: "racing@test.com" } });
    expect(count).toBe(1);
  });

  it("does NOT create a Session row (provisioning has no session side-effect)", async () => {
    const user = await createUserWithCredential(auth, {
      email: "nosession@test.com",
      password: "password123",
      name: "No Session",
    });

    const sessions = await prisma.session.count({ where: { userId: user.id } });
    expect(sessions).toBe(0);
  });
});
