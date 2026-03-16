import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockQueueAdd,
  mockWorkerOn,
  mockPassFindUnique,
  mockPassUpdate,
  mockPeriodFindUnique,
  mockPeriodFindMany,
  mockCalendarFindFirst,
  mockDestinationFindUnique,
  mockEmitPassEvent,
  mockReleaseSlot,
  mockPromoteFromQueue,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockWorkerOn: vi.fn(),
  mockPassFindUnique: vi.fn(),
  mockPassUpdate: vi.fn(),
  mockPeriodFindUnique: vi.fn(),
  mockPeriodFindMany: vi.fn(),
  mockCalendarFindFirst: vi.fn(),
  mockDestinationFindUnique: vi.fn(),
  mockEmitPassEvent: vi.fn(),
  mockReleaseSlot: vi.fn().mockResolvedValue(undefined),
  mockPromoteFromQueue: vi.fn().mockResolvedValue(undefined),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    constructor(_name: string, _opts?: unknown) {}
    add = mockQueueAdd;
  },
  Worker: class MockWorker {
    constructor(_name: string, _processor: unknown, _opts?: unknown) {}
    on = mockWorkerOn;
  },
}));

vi.mock("ioredis", () => ({
  default: class MockRedis {
    constructor(_url: string, _opts?: unknown) {}
    on = vi.fn();
  },
}));

vi.mock("../../src/env.js", () => ({
  env: { REDIS_URL: "redis://localhost:6379" },
}));

vi.mock("@hallpass/db", () => ({
  prisma: {
    pass: {
      findUnique: mockPassFindUnique,
      update: mockPassUpdate,
    },
    period: {
      findUnique: mockPeriodFindUnique,
      findMany: mockPeriodFindMany,
    },
    schoolCalendar: {
      findFirst: mockCalendarFindFirst,
    },
    destination: {
      findUnique: mockDestinationFindUnique,
    },
  },
}));

vi.mock("../../src/lib/slots.js", () => ({
  releaseSlot: mockReleaseSlot,
  promoteFromQueue: mockPromoteFromQueue,
}));

vi.mock("../../src/lib/socket.js", () => ({
  emitPassEvent: mockEmitPassEvent,
  initSocket: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { schedulePassExpiry, processPassExpiry } from "../../src/lib/queue.js";
import type { Job } from "bullmq";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(passId: number): Job {
  return { data: { passId } } as unknown as Job;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("schedulePassExpiry", () => {
  it("calls Queue.add with jobId pass-<id> and positive delay for future date", async () => {
    const futureDate = new Date(Date.now() + 60_000);

    await schedulePassExpiry(1, futureDate);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "expire",
      { passId: 1 },
      expect.objectContaining({
        jobId: "pass-1",
        delay: expect.any(Number),
      }),
    );

    const callArgs = mockQueueAdd.mock.calls[0][2] as { delay: number };
    expect(callArgs.delay).toBeGreaterThan(0);
    expect(callArgs.delay).toBeLessThanOrEqual(60_000);
  });

  it("sets delay to 0 for past dates (Math.max(0, ...))", async () => {
    const pastDate = new Date(Date.now() - 10_000);

    await schedulePassExpiry(5, pastDate);

    const callArgs = mockQueueAdd.mock.calls[0][2] as { delay: number };
    expect(callArgs.delay).toBe(0);
  });

  it("uses correct jobId for different pass IDs", async () => {
    await schedulePassExpiry(42, new Date(Date.now() + 1000));

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "expire",
      { passId: 42 },
      expect.objectContaining({ jobId: "pass-42" }),
    );
  });
});

describe("processPassExpiry — terminal statuses", () => {
  it("skips a COMPLETED pass without updating", async () => {
    mockPassFindUnique.mockResolvedValue({
      id: 1,
      status: "COMPLETED",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: { id: 2, endTime: "15:00", scheduleTypeId: 5 },
    });

    await processPassExpiry(makeJob(1));

    expect(mockPassUpdate).not.toHaveBeenCalled();
    expect(mockEmitPassEvent).not.toHaveBeenCalled();
  });

  it("skips a CANCELLED pass without updating", async () => {
    mockPassFindUnique.mockResolvedValue({
      id: 2,
      status: "CANCELLED",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: { id: 2, endTime: "15:00", scheduleTypeId: 5 },
    });

    await processPassExpiry(makeJob(2));

    expect(mockPassUpdate).not.toHaveBeenCalled();
  });

  it("skips a DENIED pass without updating", async () => {
    mockPassFindUnique.mockResolvedValue({
      id: 3,
      status: "DENIED",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: null,
    });

    await processPassExpiry(makeJob(3));

    expect(mockPassUpdate).not.toHaveBeenCalled();
  });

  it("skips an already EXPIRED pass", async () => {
    mockPassFindUnique.mockResolvedValue({
      id: 4,
      status: "EXPIRED",
      schoolId: 1,
      destinationId: 1,
      periodId: null,
      period: null,
    });

    await processPassExpiry(makeJob(4));

    expect(mockPassUpdate).not.toHaveBeenCalled();
  });

  it("returns early when pass not found", async () => {
    mockPassFindUnique.mockResolvedValue(null);

    await processPassExpiry(makeJob(999));

    expect(mockPassUpdate).not.toHaveBeenCalled();
    expect(mockEmitPassEvent).not.toHaveBeenCalled();
  });
});

describe("processPassExpiry — PENDING pass", () => {
  it("updates PENDING pass to EXPIRED and emits pass:expired", async () => {
    const pass = {
      id: 10,
      status: "PENDING",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: { id: 2, endTime: "15:00", scheduleTypeId: 5 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdate.mockResolvedValue(updatedPass);

    await processPassExpiry(makeJob(10));

    expect(mockPassUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({ status: "EXPIRED", expiredAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
    expect(mockReleaseSlot).not.toHaveBeenCalled();
  });
});

describe("processPassExpiry — WAITING pass", () => {
  it("updates WAITING pass to EXPIRED and emits pass:expired", async () => {
    const pass = {
      id: 11,
      status: "WAITING",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: { id: 2, endTime: "15:00", scheduleTypeId: 5 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdate.mockResolvedValue(updatedPass);

    await processPassExpiry(makeJob(11));

    expect(mockPassUpdate).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ status: "EXPIRED" }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
  });
});

describe("processPassExpiry — ACTIVE pass", () => {
  it("marks ACTIVE pass COMPLETED with pass:returned when it IS the last period", async () => {
    const pass = {
      id: 20,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: 3,
      period: { id: 3, endTime: "15:00", scheduleTypeId: 5 },
    };
    const updatedPass = { ...pass, status: "COMPLETED", returnedAt: new Date() };
    const destination = { id: 5, maxOccupancy: 10 };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdate.mockResolvedValue(updatedPass);
    mockDestinationFindUnique.mockResolvedValue(destination);

    // checkIsLastPeriod: current period found, calendar found, NO later periods
    mockPeriodFindUnique.mockResolvedValue({ id: 3, endTime: "15:00", scheduleTypeId: 5 });
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([]); // no later periods → is last

    await processPassExpiry(makeJob(20));

    expect(mockPassUpdate).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({ status: "COMPLETED", returnedAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:returned");
    expect(mockReleaseSlot).toHaveBeenCalledWith(5, 10);
    expect(mockPromoteFromQueue).toHaveBeenCalledWith(5, 10);
  });

  it("marks ACTIVE pass EXPIRED when there are later periods (NOT the last period)", async () => {
    const pass = {
      id: 21,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: 3,
      period: { id: 3, endTime: "10:00", scheduleTypeId: 5 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };
    const destination = { id: 5, maxOccupancy: 10 };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdate.mockResolvedValue(updatedPass);
    mockDestinationFindUnique.mockResolvedValue(destination);

    // checkIsLastPeriod: there IS a later period
    mockPeriodFindUnique.mockResolvedValue({ id: 3, endTime: "10:00", scheduleTypeId: 5 });
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([
      { id: 4, endTime: "12:00", startTime: "10:30", scheduleTypeId: 5 },
    ]);

    await processPassExpiry(makeJob(21));

    expect(mockPassUpdate).toHaveBeenCalledWith({
      where: { id: 21 },
      data: expect.objectContaining({ status: "EXPIRED", expiredAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
    expect(mockReleaseSlot).toHaveBeenCalledWith(5, 10);
    expect(mockPromoteFromQueue).toHaveBeenCalledWith(5, 10);
  });

  it("treats ACTIVE pass as last period when periodId is null → COMPLETED", async () => {
    const pass = {
      id: 22,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: null,
      period: null,
    };
    const updatedPass = { ...pass, status: "COMPLETED", returnedAt: new Date() };
    const destination = { id: 5, maxOccupancy: null };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdate.mockResolvedValue(updatedPass);
    mockDestinationFindUnique.mockResolvedValue(destination);

    await processPassExpiry(makeJob(22));

    expect(mockPassUpdate).toHaveBeenCalledWith({
      where: { id: 22 },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:returned");
  });
});
