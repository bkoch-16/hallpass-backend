/**
 * Real auth integration tests — do NOT mock @hallpass/auth.
 * Exercises the actual better-auth sign-up/sign-in flow against the live test DB.
 *
 * Run with: pnpm --filter @hallpass/user-api test:integration
 * Requires: docker-compose up -d (PostgreSQL on localhost:5432)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { prisma } from "@hallpass/db";

beforeEach(async () => {
  // Sessions and accounts are cascade-deleted with users.
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.user.deleteMany();
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
