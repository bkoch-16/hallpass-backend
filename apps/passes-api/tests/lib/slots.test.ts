import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (must be declared before vi.mock calls) ────────────────────

const { mockRedis, mockPrisma } = vi.hoisted(() => {
  const mockRedis = {
    set: vi.fn(),
    get: vi.fn(),
    decr: vi.fn(),
    incr: vi.fn(),
    on: vi.fn(),
  };
  const mockPrisma = {
    pass: {
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  return { mockRedis, mockPrisma };
});

// ─── Mock ioredis ─────────────────────────────────────────────────────────────

vi.mock("ioredis", () => ({
  default: class MockRedis {
    set = mockRedis.set;
    get = mockRedis.get;
    decr = mockRedis.decr;
    incr = mockRedis.incr;
    on = mockRedis.on;
  },
}));

// ─── Mock @hallpass/db ────────────────────────────────────────────────────────

vi.mock("@hallpass/db", () => ({
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

import { claimSlot, releaseSlot, initSlots, reconcileSlots, promoteFromQueue } from "../../src/lib/slots.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initSlots", () => {
  it("calls SET NX EX and returns true when key was newly created", async () => {
    mockRedis.set.mockResolvedValue("OK");

    const result = await initSlots(1, 10);

    expect(mockRedis.set).toHaveBeenCalledWith("slots:destination:1", 10, "EX", 86400, "NX");
    expect(result).toBe(true);
  });

  it("returns false when key already existed (SET NX returned null)", async () => {
    mockRedis.set.mockResolvedValue(null);

    const result = await initSlots(1, 10);

    expect(result).toBe(false);
  });

  it("returns false and does not call SET when maxOccupancy is null", async () => {
    const result = await initSlots(1, null);

    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe("claimSlot", () => {
  it("returns true when DECR yields a value >= 0 (slots available)", async () => {
    mockRedis.decr.mockResolvedValue(5);

    const result = await claimSlot(1, 10);

    expect(result).toBe(true);
    expect(mockRedis.decr).toHaveBeenCalledWith("slots:destination:1");
  });

  it("returns true when DECR yields 0 (last slot claimed)", async () => {
    mockRedis.decr.mockResolvedValue(0);

    const result = await claimSlot(2, 5);

    expect(result).toBe(true);
  });

  it("returns true (unlimited) when maxOccupancy is null", async () => {
    const result = await claimSlot(1, null);

    expect(result).toBe(true);
    expect(mockRedis.decr).not.toHaveBeenCalled();
  });

  it("initialises and retries when DECR returns -1 (missing key) and succeeds on retry", async () => {
    mockRedis.decr
      .mockResolvedValueOnce(-1) // key was missing
      .mockResolvedValueOnce(9); // after init with maxOccupancy=10, DECR → 9
    mockRedis.incr.mockResolvedValueOnce(0); // restore the -1 overshoot
    mockRedis.set.mockResolvedValue("OK"); // initSlots

    const result = await claimSlot(3, 10);

    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith("slots:destination:3", 10, "EX", 86400, "NX");
    // INCR once (to restore before init), not twice
    expect(mockRedis.incr).toHaveBeenCalledTimes(1);
  });

  it("returns false and restores counter when retry after init also fails", async () => {
    mockRedis.decr
      .mockResolvedValueOnce(-1) // key was missing
      .mockResolvedValueOnce(-1); // retry still negative (e.g. maxOccupancy=0)
    mockRedis.incr.mockResolvedValue(0);
    mockRedis.set.mockResolvedValue("OK");

    const result = await claimSlot(1, 0);

    expect(result).toBe(false);
    // INCR called twice: once to restore before initSlots, once to undo second failed DECR
    expect(mockRedis.incr).toHaveBeenCalledTimes(2);
  });

  it("returns false and INCRs back when DECR goes negative (no slots)", async () => {
    // Counter was at 0, so DECR → -1 and the key existed (not a missing-key scenario)
    // We simulate: first DECR = -2 (clearly negative, not -1 missing-key ambiguity)
    mockRedis.decr.mockResolvedValue(-2);
    mockRedis.incr.mockResolvedValue(-1);

    const result = await claimSlot(1, 5);

    expect(result).toBe(false);
    expect(mockRedis.incr).toHaveBeenCalledWith("slots:destination:1");
  });
});

describe("releaseSlot", () => {
  it("INCRs the counter", async () => {
    mockRedis.incr.mockResolvedValue(5);

    await releaseSlot(1, 10);

    expect(mockRedis.incr).toHaveBeenCalledWith("slots:destination:1");
  });

  it("caps counter at maxOccupancy if INCR overshoots", async () => {
    mockRedis.incr.mockResolvedValue(11); // went over maxOccupancy=10

    await releaseSlot(1, 10);

    expect(mockRedis.set).toHaveBeenCalledWith("slots:destination:1", 10);
  });

  it("does not SET when INCR result is within bounds", async () => {
    mockRedis.incr.mockResolvedValue(7);

    await releaseSlot(1, 10);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("is a no-op when maxOccupancy is null", async () => {
    await releaseSlot(1, null);

    expect(mockRedis.incr).not.toHaveBeenCalled();
  });
});

describe("reconcileSlots", () => {
  it("SETs counter to maxOccupancy - activeCount", async () => {
    mockPrisma.pass.count.mockResolvedValue(3);

    await reconcileSlots(1, 10);

    expect(mockPrisma.pass.count).toHaveBeenCalledWith({
      where: { destinationId: 1, status: "ACTIVE" },
    });
    expect(mockRedis.set).toHaveBeenCalledWith("slots:destination:1", 7);
  });

  it("is a no-op when maxOccupancy is null", async () => {
    await reconcileSlots(1, null);

    expect(mockPrisma.pass.count).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

describe("promoteFromQueue", () => {
  it("promotes the oldest WAITING pass when a slot is available", async () => {
    const waitingPass = { id: 50, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    mockRedis.decr.mockResolvedValue(3); // slot available

    await promoteFromQueue(1, 10);

    expect(mockPrisma.pass.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });

  it("does not promote if no WAITING pass exists", async () => {
    mockPrisma.pass.findFirst.mockResolvedValue(null);

    await promoteFromQueue(1, 10);

    expect(mockPrisma.pass.update).not.toHaveBeenCalled();
  });

  it("does not update pass if slot claim fails", async () => {
    const waitingPass = { id: 50, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    // DECR -2 → clearly negative, INCR to restore
    mockRedis.decr.mockResolvedValue(-2);
    mockRedis.incr.mockResolvedValue(-1);

    await promoteFromQueue(1, 5);

    expect(mockPrisma.pass.update).not.toHaveBeenCalled();
  });

  it("promotes regardless of maxOccupancy=null (unlimited)", async () => {
    const waitingPass = { id: 51, destinationId: 1, status: "WAITING", requestedAt: new Date() };
    mockPrisma.pass.findFirst.mockResolvedValue(waitingPass);
    // claimSlot returns true immediately for null maxOccupancy

    await promoteFromQueue(1, null);

    expect(mockPrisma.pass.update).toHaveBeenCalledWith({
      where: { id: 51 },
      data: expect.objectContaining({ status: "ACTIVE" }),
    });
  });
});
