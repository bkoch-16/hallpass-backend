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
  it("sign up then GET /api/users/me returns integer id > 0", async () => {
    const agent = request.agent(app);

    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .send({ email: "signup@test.com", password: "password123", name: "Sign Up User" });

    expect(signUp.status).toBe(200);

    const me = await agent.get("/api/users/me");

    expect(me.status).toBe(200);
    expect(Number.isInteger(me.body.id)).toBe(true);
    expect(me.body.id).toBeGreaterThan(0);
  });

  it("GET /api/users/me without session returns 401", async () => {
    const agent = request.agent(app);

    // Sign up to create a user, but use a fresh agent (no cookies) for the GET.
    await agent
      .post("/api/auth/sign-up/email")
      .send({ email: "nosession@test.com", password: "password123", name: "No Session" });

    const freshAgent = request.agent(app);
    const res = await freshAgent.get("/api/users/me");

    expect(res.status).toBe(401);
  });

  it("sign up then sign in returns same user id", async () => {
    const signUpAgent = request.agent(app);

    const signUp = await signUpAgent
      .post("/api/auth/sign-up/email")
      .send({ email: "roundtrip@test.com", password: "password123", name: "Round Trip" });

    expect(signUp.status).toBe(200);

    const meAfterSignUp = await signUpAgent.get("/api/users/me");
    expect(meAfterSignUp.status).toBe(200);
    const originalId = meAfterSignUp.body.id;

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

  it("public sign-up CANNOT escalate role/schoolId via the request body", async () => {
    const school = await prisma.school.create({ data: { name: "Escalation High" } });

    const agent = request.agent(app);

    // Attempt to self-provision as SUPER_ADMIN with an injected schoolId.
    const signUp = await agent.post("/api/auth/sign-up/email").send({
      email: "attacker@test.com",
      password: "password123",
      name: "Attacker",
      role: "SUPER_ADMIN",
      schoolId: school.id,
    });

    // input:false makes better-auth reject the privileged fields outright; no
    // escalated user is created.
    expect(signUp.status).toBe(400);
    const dbUser = await prisma.user.findUnique({ where: { email: "attacker@test.com" } });
    expect(dbUser).toBeNull();
  });

  it("public sign-up without privileged fields succeeds as a default STUDENT", async () => {
    const agent = request.agent(app);

    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .send({ email: "cleansignup@test.com", password: "password123", name: "Clean" });

    expect(signUp.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { email: "cleansignup@test.com" } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.role).toBe("STUDENT");
    expect(dbUser!.schoolId).toBeNull();
  });

  it("sign in with wrong password returns 401", async () => {
    const signUpAgent = request.agent(app);

    await signUpAgent
      .post("/api/auth/sign-up/email")
      .send({ email: "wrongpass@test.com", password: "password123", name: "Wrong Pass" });

    const signInAgent = request.agent(app);

    const signIn = await signInAgent
      .post("/api/auth/sign-in/email")
      .send({ email: "wrongpass@test.com", password: "wrongpassword" });

    expect(signIn.status).toBe(401);
  });
});
