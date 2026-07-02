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
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    passPolicy: {
      findFirst: vi.fn(),
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

import {
  claimSlot,
  releaseSlot,
  claimSchoolSlot,
  claimPassSlots,
  reconcileSlots,
  reconcileSchoolSlots,
  promoteFromQueue,
} from "../../src/lib/slots.js";

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

describe("claimSchoolSlot", () => {
  it("uses the slots:school:{id} key", async () => {
    mockRedis.eval.mockResolvedValue(2);

    const result = await claimSchoolSlot(7, 5);

    expect(result).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, "slots:school:7", 5);
  });

  it("returns true (unlimited) when maxActivePasses is null", async () => {
    const result = await claimSchoolSlot(7, null);

    expect(result).toBe(true);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});

describe("claimPassSlots", () => {
  it("returns true when both destination and school slots are claimed", async () => {
    mockRedis.eval
      .mockResolvedValueOnce(0) // destination claim ok
      .mockResolvedValueOnce(2); // school claim ok

    const result = await claimPassSlots(7, 5, 1, 10);

    expect(result).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledTimes(2);
  });

  it("releases the destination slot and returns false when the school counter is exhausted", async () => {
    mockRedis.eval
      .mockResolvedValueOnce(0) // destination claim ok
      .mockResolvedValueOnce(-1) // school claim fails
      .mockResolvedValueOnce(1); // destination release

    const result = await claimPassSlots(7, 5, 1, 10);

    expect(result).toBe(false);
    expect(mockRedis.eval).toHaveBeenCalledTimes(3);
    expect(mockRedis.eval.mock.calls[2][2]).toBe("slots:destination:1");
  });

  it("returns false without touching the school counter when the destination is full", async () => {
    mockRedis.eval.mockResolvedValueOnce(-1); // destination claim fails

    const result = await claimPassSlots(7, 5, 1, 10);

    expect(result).toBe(false);
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it("never touches the school key when maxActivePasses is null", async () => {
    mockRedis.eval.mockResolvedValueOnce(0); // destination claim ok

    const result = await claimPassSlots(7, null, 1, 10);

    expect(result).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    expect(mockRedis.eval.mock.calls[0][2]).toBe("slots:destination:1");
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

describe("reconcileSchoolSlots", () => {
  it("SETs slots:school:{id} to maxActivePasses - activeCount", async () => {
    mockPrisma.pass.count.mockResolvedValue(3);

    await reconcileSchoolSlots(7, 10);

    expect(mockPrisma.pass.count).toHaveBeenCalledWith({
      where: { schoolId: 7, status: "ACTIVE" },
    });
    expect(mockRedis.set).toHaveBeenCalledWith("slots:school:7", 7, "EX", 86400);
  });

  it("is a no-op when maxActivePasses is null", async () => {
    await reconcileSchoolSlots(7, null);

    expect(mockPrisma.pass.count).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

describe("promoteFromQueue", () => {
  it("promotes the oldest WAITING pass when a slot is available", async () => {
    const waitingPass = {
      id: 50,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date(),
      destination: { maxOccupancy: 10 },
    };
    const promotedPass = { ...waitingPass, status: "ACTIVE", approvedAt: new Date() };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    mockRedis.eval.mockResolvedValue(3); // slot available
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });

  it("does not promote if no WAITING pass exists", async () => {
    mockPrisma.pass.findMany.mockResolvedValue([]);

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalled();
  });

  it("does not update pass if destination slot claim fails", async () => {
    const waitingPass = {
      id: 50,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date(),
      destination: { maxOccupancy: 5 },
    };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    mockRedis.eval.mockResolvedValue(-1); // negative → no slot
    mockRedis.incr.mockResolvedValue(0); // restore call

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalled();
  });

  it("gives back both slots and abandons the candidate when another worker already promoted it", async () => {
    const waitingPass = {
      id: 60,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date(),
      destination: { maxOccupancy: 10 },
    };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    mockRedis.eval.mockResolvedValue(3); // slots always available / releases succeed
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 0 }); // race lost

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pass.findUniqueOrThrow).not.toHaveBeenCalled();
    // 2 claims (destination + school) then 2 releases (destination + school)
    expect(mockRedis.eval).toHaveBeenCalledTimes(4);
    expect(mockRedis.eval.mock.calls[2][2]).toBe("slots:destination:1");
    expect(mockRedis.eval.mock.calls[3][2]).toBe("slots:school:1");
  });

  it("promotes regardless of maxOccupancy=null (unlimited)", async () => {
    const waitingPass = {
      id: 51,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date(),
      destination: { maxOccupancy: null },
    };
    const promotedPass = { ...waitingPass, status: "ACTIVE", approvedAt: new Date() };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    // claimSlot returns true immediately for null maxOccupancy (no eval call)
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 51, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });

  it("stops entirely when the school claim fails — destination slot released, no promotion", async () => {
    const waitingPass = {
      id: 52,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date(),
      destination: { maxOccupancy: 10 },
    };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    mockRedis.eval
      .mockResolvedValueOnce(0) // destination claim ok
      .mockResolvedValueOnce(-1) // school claim fails
      .mockResolvedValueOnce(1); // destination release

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalled();
    expect(mockRedis.eval).toHaveBeenCalledTimes(3);
    expect(mockRedis.eval.mock.calls[2][2]).toBe("slots:destination:1");
  });

  it("skips a full destination and promotes the next destination's oldest candidate", async () => {
    const fullDestPass = {
      id: 53,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date("2025-09-15T08:00:00Z"),
      destination: { maxOccupancy: 10 },
    };
    const otherDestPass = {
      id: 54,
      schoolId: 1,
      destinationId: 2,
      status: "WAITING",
      requestedAt: new Date("2025-09-15T08:05:00Z"),
      destination: { maxOccupancy: 10 },
    };
    const promotedPass = { ...otherDestPass, status: "ACTIVE", activatedAt: new Date() };
    mockPrisma.pass.findMany.mockResolvedValue([fullDestPass, otherDestPass]);
    mockRedis.eval
      .mockResolvedValueOnce(-1) // destination 1 full
      .mockResolvedValueOnce(0) // destination 2 claim ok
      .mockResolvedValueOnce(0); // school claim ok
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 54, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });
});
