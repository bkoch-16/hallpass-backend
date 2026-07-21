/**
 * Real invite-flow integration tests — do NOT mock @hallpass/auth.
 * Provisioning routes (POST /api/users, POST /api/users/bulk) must send an
 * invite email containing a set-password link/token for every successfully
 * created user; the token is consumed by the EXISTING public
 * POST /api/auth/reset-password (a better-auth reset-password token, single
 * use). Contract is additive: tempPassword / {created, failed} response
 * shapes are unchanged.
 *
 * Run with: pnpm --filter @hallpass/user-api test:integration
 * Requires: docker-compose up -d (PostgreSQL on localhost:5432)
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "@hallpass/db";
import { createUserWithCredential } from "@hallpass/auth";
import { auth } from "../../src/auth.js";
import { emailSender } from "../../src/email.js";

const sendSpy = vi.spyOn(emailSender, "send");

function tokenFromMessage(message: { text: string }): string {
  const match = message.text.match(/[?&]token=([^\s&]+)/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]);
}

async function createAdminAgent(schoolId: number) {
  const email = `admin-${schoolId}@test.com`;
  await createUserWithCredential(auth, {
    email,
    password: "adminpassword123",
    name: "Admin User",
    role: "ADMIN",
    schoolId,
  });
  const agent = request.agent(app);
  const signIn = await agent.post("/api/auth/sign-in/email").send({ email, password: "adminpassword123" });
  expect(signIn.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  sendSpy.mockClear();
  // Sessions, accounts, and verification tokens are cascade/independent rows;
  // users cascade sessions and accounts.
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.verification.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.$disconnect();
});

describe("Invite flow (integration)", () => {
  it("POST /api/users sends one invite email; its token resets the password; tempPassword also works before reset", async () => {
    const school = await prisma.school.create({ data: { name: "Invite High" } });
    const adminAgent = await createAdminAgent(school.id);

    const create = await adminAgent
      .post("/api/users")
      .send({ email: "invitee@test.com", name: "Invitee", role: "TEACHER" });

    expect(create.status).toBe(201);
    const tempPassword: string = create.body.tempPassword;
    expect(typeof tempPassword).toBe("string");
    expect(tempPassword.length).toBeGreaterThan(0);

    // Additive contract: the tempPassword still works, BEFORE the invite is redeemed.
    const tempSignIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "invitee@test.com", password: tempPassword });
    expect(tempSignIn.status).toBe(200);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const message = sendSpy.mock.calls[0][0];
    expect(message.to).toBe("invitee@test.com");
    const token = tokenFromMessage(message);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "chosenpassword456", token });
    expect(reset.status).toBe(200);

    const newSignIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "invitee@test.com", password: "chosenpassword456" });
    expect(newSignIn.status).toBe(200);
  });

  it("POST /api/users/bulk sends an invite email only for each successfully-created user", async () => {
    const school = await prisma.school.create({ data: { name: "Bulk Invite High" } });
    const adminAgent = await createAdminAgent(school.id);

    // Pre-existing user so one of the 3 bulk rows collides.
    await createUserWithCredential(auth, {
      email: "existing@test.com",
      password: "password123",
      name: "Existing User",
      role: "STUDENT",
      schoolId: school.id,
    });

    const bulk = await adminAgent
      .post("/api/users/bulk")
      .send([
        { email: "existing@test.com", name: "Duplicate" },
        { email: "fresh1@test.com", name: "Fresh One" },
        { email: "fresh2@test.com", name: "Fresh Two" },
      ]);

    expect(bulk.status).toBe(200);
    expect(bulk.body.created).toBe(2);
    expect(bulk.body.failed).toHaveLength(1);
    expect(bulk.body.failed[0].email).toBe("existing@test.com");

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual(["fresh1@test.com", "fresh2@test.com"]);
  });

  it("invite token is single-use: a second reset-password with the same token is rejected", async () => {
    const school = await prisma.school.create({ data: { name: "Single Use High" } });
    const adminAgent = await createAdminAgent(school.id);

    await adminAgent.post("/api/users").send({ email: "onceonly@test.com", name: "Once Only", role: "TEACHER" });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const token = tokenFromMessage(sendSpy.mock.calls[0][0]);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "firstpassword456", token });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "secondpassword789", token });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
  });

  it("email-send failure never fails provisioning: POST /api/users still returns 201 with tempPassword", async () => {
    const school = await prisma.school.create({ data: { name: "Email Down High" } });
    const adminAgent = await createAdminAgent(school.id);

    sendSpy.mockRejectedValueOnce(new Error("SES is down"));

    const create = await adminAgent
      .post("/api/users")
      .send({ email: "resilient@test.com", name: "Resilient User", role: "TEACHER" });

    expect(create.status).toBe(201);
    expect(typeof create.body.tempPassword).toBe("string");
    expect(create.body.tempPassword.length).toBeGreaterThan(0);
  });

  it("the invite email is a distinct template from the password-reset email", async () => {
    const school = await prisma.school.create({ data: { name: "Distinct Template High" } });
    const adminAgent = await createAdminAgent(school.id);

    await adminAgent
      .post("/api/users")
      .send({ email: "distinct@test.com", name: "Distinct User", role: "TEACHER" });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const message = sendSpy.mock.calls[0][0];
    expect(message.subject).not.toBe("Reset your Hallpass password");
    expect(message.subject.toLowerCase()).toMatch(/invite|welcome/);
  });
});
