/**
 * Real password-reset integration tests — do NOT mock @hallpass/auth.
 * Exercises the actual better-auth request-password-reset / reset-password
 * flow against the live test DB. The email sender is spied on (SES is not
 * configured in tests, so the fallback logging sender is in play) to capture
 * the reset token from the outgoing message.
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

function sentToken(): string {
  expect(sendSpy).toHaveBeenCalledTimes(1);
  const message = sendSpy.mock.calls[0][0];
  const match = message.text.match(/[?&]token=([^\s&]+)/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]);
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

describe("Password reset flow (integration)", () => {
  it("request-password-reset emails a token that resets the password", async () => {
    await createUserWithCredential(auth, {
      email: "resetme@test.com",
      password: "oldpassword123",
      name: "Reset Me",
    });

    const requestReset = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: "resetme@test.com" });
    expect(requestReset.status).toBe(200);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe("resetme@test.com");
    const token = sentToken();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "newpassword456", token });
    expect(reset.status).toBe(200);

    const oldSignIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "resetme@test.com", password: "oldpassword123" });
    expect(oldSignIn.status).toBe(401);

    const newSignIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "resetme@test.com", password: "newpassword456" });
    expect(newSignIn.status).toBe(200);
  });

  it("request for an unknown email returns 200 and sends nothing (no enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: "nobody@test.com" });

    expect(res.status).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("an invalid token is rejected and the password is unchanged", async () => {
    await createUserWithCredential(auth, {
      email: "badtoken@test.com",
      password: "password123",
      name: "Bad Token",
    });

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "newpassword456", token: "not-a-real-token" });
    expect(reset.status).toBeGreaterThanOrEqual(400);
    expect(reset.status).toBeLessThan(500);

    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "badtoken@test.com", password: "password123" });
    expect(signIn.status).toBe(200);
  });

  it("a token cannot be used twice", async () => {
    await createUserWithCredential(auth, {
      email: "reuse@test.com",
      password: "password123",
      name: "Reuse Token",
    });

    const requestReset = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: "reuse@test.com" });
    expect(requestReset.status).toBe(200);
    const token = sentToken();

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "newpassword456", token });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "anotherpassword789", token });
    expect(second.status).toBeGreaterThanOrEqual(400);

    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "reuse@test.com", password: "newpassword456" });
    expect(signIn.status).toBe(200);
  });
});
