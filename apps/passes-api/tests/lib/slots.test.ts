import { describe, it, expect, vi, beforeEach } from "vitest";
import { passStatusMock } from "../utils/passStatusMock.js";

// ─── Hoisted mocks (must be declared before vi.mock calls) ────────────────────

const { mockRedis, mockPrisma } = vi.hoisted(() => {
  const mockRedis = {
    set: vi.fn(),
    get: vi.fn(),
    eval: vi.fn(),
    incr: vi.fn(),
    on: vi.fn(),
  };
  const mockPrisma = {
    pass: {
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  return { mockRedis, mockPrisma };
});

// ─── Mock ioredis ─────────────────────────────────────────────────────────────

vi.mock("ioredis", () => ({
  default: class MockRedis {
    set = mockRedis.set;
    get = mockRedis.get;
    eval = mockRedis.eval;
    incr = mockRedis.incr;
    on = mockRedis.on;
  },
}));

// ─── Mock @hallpass/db ────────────────────────────────────────────────────────

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  prisma: mockPrisma,
}));

// ─── Mock env ─────────────────────────────────────────────────────────────────

vi.mock("../../src/env.js", () => ({
  env: { REDIS_URL: "redis://localhost:6379" },
}));

// ─── Mock socket (slots now imports emitPassEvent) ────────────────────────────

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { claimSlot, releaseSlot, reconcileSlots, promoteFromQueue } from "../../src/lib/slots.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimSlot", () => {
  it("returns true when Lua script yields a value >= 0 (slots available)", async () => {
    mockRedis.eval.mockResolvedValue(5);

    const result = await claimSlot(1, 10);

    expect(result).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, "slots:destination:1", 10);
  });

  it("returns true when Lua script yields 0 (last slot claimed)", async () => {
    mockRedis.eval.mockResolvedValue(0);

    const result = await claimSlot(2, 5);

    expect(result).toBe(true);
  });

  it("returns true (unlimited) when maxOccupancy is null", async () => {
    const result = await claimSlot(1, null);

    expect(result).toBe(true);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("returns false when Lua script returns -1 (no slots, counter already restored by Lua)", async () => {
    mockRedis.eval.mockResolvedValue(-1);

    const result = await claimSlot(1, 5);

    expect(result).toBe(false);
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });
});

describe("releaseSlot", () => {
  it("calls eval with the correct key and maxOccupancy", async () => {
    mockRedis.eval.mockResolvedValue(5);

    await releaseSlot(1, 10);

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "slots:destination:1",
      10,
    );
  });

  it("is a no-op when maxOccupancy is null", async () => {
    await releaseSlot(1, null);

    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("Lua script includes EXPIRE call on normal INCR path (val <= max)", async () => {
    mockRedis.eval.mockResolvedValue(5); // val = 5, within max

    await releaseSlot(1, 10);

    const luaScript = mockRedis.eval.mock.calls[0][0] as string;
    expect(luaScript).toContain("EXPIRE");
    expect(luaScript).toContain("86400");
  });
});

describe("reconcileSlots", () => {
  it("SETs counter to maxOccupancy - activeCount", async () => {
    mockPrisma.pass.count.mockResolvedValue(3);

    await reconcileSlots(1, 10);

    expect(mockPrisma.pass.count).toHaveBeenCalledWith({
      where: { destinationId: 1, status: "ACTIVE" },
    });
    expect(mockRedis.set).toHaveBeenCalledWith("slots:destination:1", 7, "EX", 86400);
  });

  it("is a no-op when maxOccupancy is null", async () => {
    await reconcileSlots(1, null);

    expect(mockPrisma.pass.count).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("clamps counter to 0 when activeCount exceeds maxOccupancy", async () => {
    mockPrisma.pass.count.mockResolvedValue(5);

    await reconcileSlots(1, 3);

    expect(mockRedis.set).toHaveBeenCalledWith("slots:destination:1", 0, "EX", 86400);
  });
});

describe("promoteFromQueue", () => {
  it("promotes the oldest WAITING pass when a slot is available", async () => {
    const waitingPass = { id: 50, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    const promotedPass = { ...waitingPass, status: "ACTIVE", approvedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    mockRedis.eval.mockResolvedValue(3); // slot available
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, 10);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });

  it("does not promote if no WAITING pass exists", async () => {
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    await promoteFromQueue(1, 10);

    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalled();
  });

  it("does not update pass if slot claim fails", async () => {
    const waitingPass = { id: 50, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    mockRedis.eval.mockResolvedValue(-1); // negative → no slot
    mockRedis.incr.mockResolvedValue(0); // restore call

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalled();
  });

  it("retries once when another worker already promoted the pass (count=0 then count=1)", async () => {
    const waitingPass = { id: 60, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    const promotedPass = { ...waitingPass, status: "ACTIVE", activatedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    mockRedis.eval.mockResolvedValue(3); // slot always available
    mockPrisma.pass.updateMany
      .mockResolvedValueOnce({ count: 0 }) // first call: race lost
      .mockResolvedValueOnce({ count: 1 }); // retry: success
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, 10);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledTimes(2);
  });

  it("promotes regardless of maxOccupancy=null (unlimited)", async () => {
    const waitingPass = { id: 51, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    const promotedPass = { ...waitingPass, status: "ACTIVE", approvedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    // claimSlot returns true immediately for null maxOccupancy (no eval call)
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 51, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });
});
