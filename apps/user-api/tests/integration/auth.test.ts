/**
 * Real auth integration tests — do NOT mock @hallpass/auth.
 * Exercises the actual better-auth sign-up/sign-in flow against the live test DB.
 *
 * Run with: pnpm --filter @hallpass/user-api test:integration
 * Requires: docker-compose up -d (PostgreSQL on localhost:5432)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "@hallpass/db";
import { createUserWithCredential } from "@hallpass/auth";
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

describe("Real auth flow (integration)", () => {
  it("provisioned user then GET /api/users/me returns integer id > 0", async () => {
    await createUserWithCredential(auth, {
      email: "signup@test.com",
      password: "password123",
      name: "Sign Up User",
    });

    const agent = request.agent(app);

    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .send({ email: "signup@test.com", password: "password123" });
    expect(signIn.status).toBe(200);

    const me = await agent.get("/api/users/me");

    expect(me.status).toBe(200);
    expect(Number.isInteger(me.body.id)).toBe(true);
    expect(me.body.id).toBeGreaterThan(0);
  });

  it("GET /api/users/me without session returns 401", async () => {
    // Provision a user, but use a fresh agent (no cookies) for the GET.
    await createUserWithCredential(auth, {
      email: "nosession@test.com",
      password: "password123",
      name: "No Session",
    });

    const freshAgent = request.agent(app);
    const res = await freshAgent.get("/api/users/me");

    expect(res.status).toBe(401);
  });

  it("provisioned user can sign in twice and gets the same user id", async () => {
    await createUserWithCredential(auth, {
      email: "roundtrip@test.com",
      password: "password123",
      name: "Round Trip",
    });

    const firstAgent = request.agent(app);

    const firstSignIn = await firstAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "roundtrip@test.com", password: "password123" });
    expect(firstSignIn.status).toBe(200);

    const meAfterFirstSignIn = await firstAgent.get("/api/users/me");
    expect(meAfterFirstSignIn.status).toBe(200);
    const originalId = meAfterFirstSignIn.body.id;

    const signInAgent = request.agent(app);

    const signIn = await signInAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "roundtrip@test.com", password: "password123" });

    expect(signIn.status).toBe(200);

    const meAfterSignIn = await signInAgent.get("/api/users/me");
    expect(meAfterSignIn.status).toBe(200);
    expect(meAfterSignIn.body.id).toBe(originalId);
  });

  it("admin provisions a user via POST /api/users; new user signs in with returned tempPassword and reaches /me", async () => {
    const school = await prisma.school.create({ data: { name: "Provision High" } });

    // Bootstrap an authorized admin scoped to the school.
    await createUserWithCredential(auth, {
      email: "admin@test.com",
      password: "password123",
      name: "Admin User",
      role: "ADMIN",
      schoolId: school.id,
    });

    const adminAgent = request.agent(app);
    const adminSignIn = await adminAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "admin@test.com", password: "password123" });
    expect(adminSignIn.status).toBe(200);

    // Provision a new user THROUGH the endpoint.
    const create = await adminAgent
      .post("/api/users")
      .send({ email: "provisioned@test.com", name: "Provisioned User", role: "TEACHER" });

    expect(create.status).toBe(201);
    expect(typeof create.body.tempPassword).toBe("string");
    expect(create.body.tempPassword.length).toBeGreaterThan(0);
    // Admin is school-scoped, so the created user inherits the admin's schoolId.
    expect(create.body.schoolId).toBe(school.id);
    expect(create.body.role).toBe("TEACHER");

    const tempPassword: string = create.body.tempPassword;

    // The provisioned user can actually SIGN IN with the one-time password.
    const newUserAgent = request.agent(app);
    const signIn = await newUserAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "provisioned@test.com", password: tempPassword });
    expect(signIn.status).toBe(200);

    const me = await newUserAgent.get("/api/users/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("provisioned@test.com");
    expect(me.body.role).toBe("TEACHER");
    expect(me.body.schoolId).toBe(school.id);
  });

  it("public sign-up is disabled: POST /api/auth/sign-up/email is rejected and creates no user", async () => {
    const agent = request.agent(app);

    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .send({ email: "attacker@test.com", password: "password123", name: "Attacker" });

    // disableSignUp: true closes public self-signup; provisioning is admin-driven
    // (POST /api/users) via createUserWithCredential instead.
    expect(signUp.status).toBe(400);
    const dbUser = await prisma.user.findUnique({ where: { email: "attacker@test.com" } });
    expect(dbUser).toBeNull();
  });

  it("change password works for sign-in and revokes other sessions", async () => {
    await createUserWithCredential(auth, {
      email: "changepass@test.com",
      password: "password123",
      name: "Change Pass",
    });

    const agent = request.agent(app);
    const signIn = await agent
      .post("/api/auth/sign-in/email")
      .send({ email: "changepass@test.com", password: "password123" });
    expect(signIn.status).toBe(200);

    // A second signed-in session that revokeOtherSessions should kill.
    const otherAgent = request.agent(app);
    const otherSignIn = await otherAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "changepass@test.com", password: "password123" });
    expect(otherSignIn.status).toBe(200);
    expect((await otherAgent.get("/api/users/me")).status).toBe(200);

    const change = await agent
      .post("/api/auth/change-password")
      .send({
        currentPassword: "password123",
        newPassword: "newpassword456",
        revokeOtherSessions: true,
      });
    expect(change.status).toBe(200);

    // The session that changed the password survives; the other is revoked.
    expect((await agent.get("/api/users/me")).status).toBe(200);
    expect((await otherAgent.get("/api/users/me")).status).toBe(401);

    const oldPasswordAgent = request.agent(app);
    const oldSignIn = await oldPasswordAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "changepass@test.com", password: "password123" });
    expect(oldSignIn.status).toBe(401);

    const newPasswordAgent = request.agent(app);
    const newSignIn = await newPasswordAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "changepass@test.com", password: "newpassword456" });
    expect(newSignIn.status).toBe(200);
  });

  it("DELETE /api/users/:id revokes the deleted user's session immediately", async () => {
    const school = await prisma.school.create({ data: { name: "Revoke High" } });

    await createUserWithCredential(auth, {
      email: "admin-revoke@test.com",
      password: "adminpassword123",
      name: "Admin User",
      role: "ADMIN",
      schoolId: school.id,
    });
    const adminAgent = request.agent(app);
    const adminSignIn = await adminAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "admin-revoke@test.com", password: "adminpassword123" });
    expect(adminSignIn.status).toBe(200);

    await createUserWithCredential(auth, {
      email: "student-revoke@test.com",
      password: "studentpassword123",
      name: "Student User",
      role: "STUDENT",
      schoolId: school.id,
    });
    const studentAgent = request.agent(app);
    const studentSignIn = await studentAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "student-revoke@test.com", password: "studentpassword123" });
    expect(studentSignIn.status).toBe(200);

    const meBeforeDelete = await studentAgent.get("/api/users/me");
    expect(meBeforeDelete.status).toBe(200);
    const studentId: number = meBeforeDelete.body.id;

    // The student's session is valid against better-auth's own endpoint too.
    const sessionBeforeDelete = await studentAgent.get("/api/auth/get-session");
    expect(sessionBeforeDelete.body).not.toBeNull();

    const del = await adminAgent.delete(`/api/users/${studentId}`);
    expect(del.status).toBe(204);

    // The same still-cached session token no longer resolves anywhere.
    const sessionAfterDelete = await studentAgent.get("/api/auth/get-session");
    expect(sessionAfterDelete.body).toBeNull();

    const meAfterDelete = await studentAgent.get("/api/users/me");
    expect(meAfterDelete.status).toBe(401);
  });

  it("sign in with wrong password returns 401", async () => {
    await createUserWithCredential(auth, {
      email: "wrongpass@test.com",
      password: "password123",
      name: "Wrong Pass",
    });

    const signInAgent = request.agent(app);

    const signIn = await signInAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "wrongpass@test.com", password: "wrongpassword" });

    expect(signIn.status).toBe(401);
  });
});
