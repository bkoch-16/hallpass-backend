import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { passStatusMock } from "../utils/passStatusMock.js";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  prisma: {
    user: { findFirst: vi.fn() },
    pass: { findMany: vi.fn() },
    destination: { findMany: vi.fn() },
    passPolicy: { findMany: vi.fn() },
  },
}));

vi.mock("../../src/lib/slots.js", () => ({
  claimPassSlots: vi.fn(),
  releasePassSlots: vi.fn(),
  releaseAndPromote: vi.fn(),
  getMaxActivePasses: vi.fn(),
  reconcileSlots: vi.fn().mockResolvedValue(undefined),
  reconcileSchoolSlots: vi.fn().mockResolvedValue(undefined),
  promoteFromQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

vi.mock("../../src/lib/expiry.js", () => ({
  scheduleLocalExpiry: vi.fn(),
  expirePass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/redis.js", () => ({
  redis: { call: vi.fn().mockResolvedValue("fakesha") },
}));

vi.mock("@hallpass/auth", () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
  toNodeHandler: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  fromNodeHeaders: vi.fn((headers: Record<string, string>) => new Headers(headers)),
}));

import app from "../../src/app";
import { createTestServer } from "@hallpass/express-middleware";
import { prisma } from "@hallpass/db";
import { scheduleLocalExpiry, expirePass } from "../../src/lib/expiry.js";

const mockScheduleLocalExpiry = scheduleLocalExpiry as unknown as ReturnType<typeof vi.fn>;
const mockExpirePass = expirePass as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  pass: { findMany: ReturnType<typeof vi.fn> };
  destination: { findMany: ReturnType<typeof vi.fn> };
  passPolicy: { findMany: ReturnType<typeof vi.fn> };
};

const ENDPOINT = "/internal/reconcile-expiry";
// Matches INTERNAL_SECRET in vitest.config.ts
const AUTH_HEADER = "Bearer test-internal-secret";

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks wipes the module-level mockResolvedValue — the route awaits
  // expirePass for due passes, so it must stay a promise
  mockExpirePass.mockResolvedValue(undefined);
  // No waiting passes, no capped destinations/policies unless a test overrides
  mockPrisma.pass.findMany.mockResolvedValue([]);
  mockPrisma.destination.findMany.mockResolvedValue([]);
  mockPrisma.passPolicy.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

const { server, start, stop } = createTestServer(app);
beforeAll(start);
afterAll(stop);

describe("POST /internal/reconcile-expiry", () => {
  it("returns 401 without the internal secret", async () => {
    const res = await request(server).post(ENDPOINT);

    expect(res.status).toBe(401);
    expect(mockPrisma.pass.findMany).not.toHaveBeenCalled();
  });

  it("expires a stale ACTIVE pass from a previous calendar day immediately", async () => {
    // Only fake Date — supertest needs real timers
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-07T10:00:00Z"));

    const stalePass = {
      id: 1,
      status: "ACTIVE",
      requestedAt: new Date("2026-07-06T18:00:00Z"), // yesterday, school-local
      period: { endTime: "15:00", scheduleType: { endBuffer: 0 } },
      school: { timezone: "UTC" },
    };
    mockPrisma.pass.findMany
      .mockResolvedValueOnce([stalePass]) // batched in-flight scan
      .mockResolvedValueOnce([]); // waiting-schools scan

    const res = await request(server).post(ENDPOINT).set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(1);
    // Due now (prior-day) → expired immediately, NOT armed for today's period end (15:00)
    expect(mockExpirePass).toHaveBeenCalledWith(1);
    expect(mockScheduleLocalExpiry).not.toHaveBeenCalled();
  });

  it("arms a same-day ACTIVE pass to its period end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-07T10:00:00Z"));

    const todayPass = {
      id: 2,
      status: "ACTIVE",
      requestedAt: new Date("2026-07-07T09:00:00Z"), // today, within its period
      period: { endTime: "15:00", scheduleType: { endBuffer: 5 } },
      school: { timezone: "UTC" },
    };
    mockPrisma.pass.findMany
      .mockResolvedValueOnce([todayPass])
      .mockResolvedValueOnce([]);

    const res = await request(server).post(ENDPOINT).set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(1);
    // periodEndDate("15:00", 5, "UTC") for today — future, so arm a local timer
    expect(mockScheduleLocalExpiry).toHaveBeenCalledWith(
      2,
      new Date("2026-07-07T15:05:00.000Z"),
    );
    expect(mockExpirePass).not.toHaveBeenCalled();
  });

  it("expires a pass immediately when its period was deleted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-07T10:00:00Z"));

    const orphanPass = {
      id: 3,
      status: "ACTIVE",
      requestedAt: new Date("2026-07-07T09:00:00Z"),
      period: null,
      school: { timezone: "UTC" },
    };
    mockPrisma.pass.findMany
      .mockResolvedValueOnce([orphanPass])
      .mockResolvedValueOnce([]);

    const res = await request(server).post(ENDPOINT).set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(mockExpirePass).toHaveBeenCalledWith(3);
  });
});
