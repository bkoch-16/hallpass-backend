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
  env: { REDIS_URL: "redis://localhost:6379", REDIS_PREFIX: "test" },
}));

// ─── Mock socket (slots now imports emitPassEvent) ────────────────────────────

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: vi.fn(),
  initSocket: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  claimPassSlots,
  releasePassSlots,
  reconcileSlots,
  reconcileSchoolSlots,
  promoteFromQueue,
} from "../../src/lib/slots.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimPassSlots", () => {
  it("returns 'claimed' in a single eval when both slots are claimed", async () => {
    mockRedis.eval.mockResolvedValue(1);

    const result = await claimPassSlots(7, 5, 1, 10);

    expect(result).toBe("claimed");
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "test:slots:destination:1",
      "test:slots:school:7",
      10,
      5,
    );
  });

  it("returns 'destination_full' when the script reports the destination exhausted", async () => {
    mockRedis.eval.mockResolvedValue(0);

    const result = await claimPassSlots(7, 5, 1, 10);

    expect(result).toBe("destination_full");
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it("returns 'school_full' when the script reports the school cap exhausted (destination rolled back in-script)", async () => {
    mockRedis.eval.mockResolvedValue(-1);

    const result = await claimPassSlots(7, 5, 1, 10);

    expect(result).toBe("school_full");
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it("passes -1 (unlimited) for a null max and still makes one round trip", async () => {
    mockRedis.eval.mockResolvedValue(1);

    const result = await claimPassSlots(7, null, 1, 10);

    expect(result).toBe("claimed");
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "test:slots:destination:1",
      "test:slots:school:7",
      10,
      -1,
    );
  });

  it("returns 'claimed' without touching Redis when both maxes are null", async () => {
    const result = await claimPassSlots(7, null, 1, null);

    expect(result).toBe("claimed");
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("returns 'destination_full' without touching Redis when maxOccupancy is 0", async () => {
    const result = await claimPassSlots(7, 5, 1, 0);

    expect(result).toBe("destination_full");
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("returns 'school_full' without touching Redis when maxActivePasses is 0", async () => {
    const result = await claimPassSlots(7, 0, 1, 10);

    expect(result).toBe("school_full");
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("Lua script includes EXPIRE with the slot TTL", async () => {
    mockRedis.eval.mockResolvedValue(1);

    await claimPassSlots(7, 5, 1, 10);

    const luaScript = mockRedis.eval.mock.calls[0][0] as string;
    expect(luaScript).toContain("EXPIRE");
    expect(luaScript).toContain("86400");
  });
});

describe("releasePassSlots", () => {
  it("releases both slots in a single eval", async () => {
    mockRedis.eval.mockResolvedValue(1);

    await releasePassSlots(7, 5, 1, 10);

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "test:slots:destination:1",
      "test:slots:school:7",
      10,
      5,
    );
  });

  it("is a no-op when both maxes are null", async () => {
    await releasePassSlots(7, null, 1, null);

    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it("passes -1 (unlimited) for a null max so the script skips that key", async () => {
    mockRedis.eval.mockResolvedValue(1);

    await releasePassSlots(7, null, 1, 10);

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "test:slots:destination:1",
      "test:slots:school:7",
      10,
      -1,
    );
  });
});

describe("reconcileSlots", () => {
  it("SETs counter to maxOccupancy - activeCount", async () => {
    mockPrisma.pass.count.mockResolvedValue(3);

    await reconcileSlots(1, 10);

    expect(mockPrisma.pass.count).toHaveBeenCalledWith({
      where: { destinationId: 1, status: "ACTIVE" },
    });
    expect(mockRedis.set).toHaveBeenCalledWith("test:slots:destination:1", 7, "EX", 86400);
  });

  it("is a no-op when maxOccupancy is null", async () => {
    await reconcileSlots(1, null);

    expect(mockPrisma.pass.count).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("clamps counter to 0 when activeCount exceeds maxOccupancy", async () => {
    mockPrisma.pass.count.mockResolvedValue(5);

    await reconcileSlots(1, 3);

    expect(mockRedis.set).toHaveBeenCalledWith("test:slots:destination:1", 0, "EX", 86400);
  });
});

describe("reconcileSchoolSlots", () => {
  it("SETs slots:school:{id} to maxActivePasses - activeCount", async () => {
    mockPrisma.pass.count.mockResolvedValue(3);

    await reconcileSchoolSlots(7, 10);

    expect(mockPrisma.pass.count).toHaveBeenCalledWith({
      where: { schoolId: 7, status: "ACTIVE" },
    });
    expect(mockRedis.set).toHaveBeenCalledWith("test:slots:school:7", 7, "EX", 86400);
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
    const promotedPass = {
      ...waitingPass,
      status: "ACTIVE",
      approvedAt: new Date(),
      student: { name: "Fake Student" },
      requester: { name: "Fake Requester" },
      destination: { ...waitingPass.destination, name: "Library" },
    };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    mockRedis.eval.mockResolvedValue(1); // both slots claimed
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 50, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
    // WAITING passes are fetched in bounded batches, oldest first
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      }),
    );
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
    mockRedis.eval.mockResolvedValue(0); // destination full

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
    mockRedis.eval.mockResolvedValue(1); // claims and releases succeed
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 0 }); // race lost

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pass.findUniqueOrThrow).not.toHaveBeenCalled();
    // one combined claim, then one combined release of both slots
    expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    expect(mockRedis.eval.mock.calls[1][2]).toBe("test:slots:destination:1");
    expect(mockRedis.eval.mock.calls[1][3]).toBe("test:slots:school:1");
  });

  it("retries the next-oldest WAITING pass for the same destination after a lost race", async () => {
    const older = {
      id: 60,
      schoolId: 1,
      destinationId: 1,
      status: "WAITING",
      requestedAt: new Date("2026-01-01T10:00:00Z"),
      destination: { maxOccupancy: 10 },
    };
    const newer = { ...older, id: 61, requestedAt: new Date("2026-01-01T10:05:00Z") };
    mockPrisma.pass.findMany.mockResolvedValue([older, newer]);
    mockRedis.eval.mockResolvedValue(1); // claims and releases always succeed
    mockPrisma.pass.updateMany
      .mockResolvedValueOnce({ count: 0 }) // race lost on id 60
      .mockResolvedValueOnce({ count: 1 }); // id 61 promoted
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue({
      ...newer,
      status: "ACTIVE",
      student: { name: "Fake Student" },
      requester: { name: "Fake Requester" },
      destination: { ...newer.destination, name: "Library" },
    });

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.pass.updateMany.mock.calls[1][0].where).toEqual({
      id: 61,
      status: "WAITING",
    });
    expect(mockPrisma.pass.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 61 } }),
    );
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
    const promotedPass = {
      ...waitingPass,
      status: "ACTIVE",
      approvedAt: new Date(),
      student: { name: "Fake Student" },
      requester: { name: "Fake Requester" },
      destination: { ...waitingPass.destination, name: "Library" },
    };
    mockPrisma.pass.findMany.mockResolvedValue([waitingPass]);
    // claimPassSlots returns "claimed" immediately when both maxes are null (no eval call)
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
    // school cap exhausted — the script rolls the destination claim back itself
    mockRedis.eval.mockResolvedValue(-1);

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalled();
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it("does not promote a WAITING pass whose destination is soft-deleted, but still promotes one to a live destination", async () => {
    // Oldest WAITING pass points at a soft-deleted destination and must be skipped;
    // the next pass points at a live destination and must still be promoted (no starvation).
    const liveDestPass = {
      id: 71,
      schoolId: 1,
      destinationId: 2,
      status: "WAITING",
      requestedAt: new Date("2025-09-15T08:05:00Z"),
      destination: { maxOccupancy: 10, deletedAt: null },
    };
    const promotedPass = {
      ...liveDestPass,
      status: "ACTIVE",
      activatedAt: new Date(),
      student: { name: "Fake Student" },
      requester: { name: "Fake Requester" },
      destination: { ...liveDestPass.destination, name: "Library" },
    };
    // The query is expected to exclude soft-deleted destinations, so it only ever
    // returns the live-destination pass. Mock that filtered result.
    mockPrisma.pass.findMany.mockResolvedValue([liveDestPass]);
    mockRedis.eval.mockResolvedValue(1); // live destination + school claimed
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, 5);

    // The WAITING query must filter out passes headed to a soft-deleted destination.
    expect(mockPrisma.pass.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          destination: { deletedAt: null },
        }),
      }),
    );
    // Only the live-destination pass is promoted; the soft-deleted one never is.
    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 71, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
    expect(mockPrisma.pass.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 70, status: "WAITING" } }),
    );
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
    const promotedPass = {
      ...otherDestPass,
      status: "ACTIVE",
      activatedAt: new Date(),
      student: { name: "Fake Student" },
      requester: { name: "Fake Requester" },
      destination: { ...otherDestPass.destination, name: "Library" },
    };
    mockPrisma.pass.findMany.mockResolvedValue([fullDestPass, otherDestPass]);
    mockRedis.eval
      .mockResolvedValueOnce(0) // destination 1 full
      .mockResolvedValueOnce(1); // destination 2 + school claimed
    mockPrisma.pass.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.pass.findUniqueOrThrow.mockResolvedValue(promotedPass);

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.updateMany).toHaveBeenCalledWith({
      where: { id: 54, status: "WAITING" },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });
});
