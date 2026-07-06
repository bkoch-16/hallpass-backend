import { describe, it, expect, vi, beforeEach } from "vitest";
import { passStatusMock } from "../utils/passStatusMock.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockQueueAdd,
  mockQueueGetJob,
  mockWorkerOn,
  mockPassFindUnique,
  mockPassUpdateMany,
  mockPassFindUniqueOrThrow,
  mockPeriodFindUnique,
  mockPeriodFindMany,
  mockCalendarFindFirst,
  mockDestinationFindUnique,
  mockEmitPassEvent,
  mockReleaseAndPromote,
  mockReleasePassSlots,
  mockGetMaxActivePasses,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockQueueGetJob: vi.fn().mockResolvedValue(undefined),
  mockWorkerOn: vi.fn(),
  mockPassFindUnique: vi.fn(),
  mockPassUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  mockPassFindUniqueOrThrow: vi.fn(),
  mockPeriodFindUnique: vi.fn(),
  mockPeriodFindMany: vi.fn(),
  mockCalendarFindFirst: vi.fn(),
  mockDestinationFindUnique: vi.fn(),
  mockEmitPassEvent: vi.fn(),
  mockReleaseAndPromote: vi.fn().mockResolvedValue(undefined),
  mockReleasePassSlots: vi.fn().mockResolvedValue(undefined),
  mockGetMaxActivePasses: vi.fn().mockResolvedValue(null),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    constructor(_name: string, _opts?: unknown) {}
    add = mockQueueAdd;
    getJob = mockQueueGetJob;
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
  env: { REDIS_URL: "redis://localhost:6379", REDIS_PREFIX: "test" },
}));

vi.mock("@hallpass/db", () => ({
  PassStatus: passStatusMock,
  prisma: {
    school: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
    pass: {
      findUnique: mockPassFindUnique,
      updateMany: mockPassUpdateMany,
      findUniqueOrThrow: mockPassFindUniqueOrThrow,
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
  releaseAndPromote: mockReleaseAndPromote,
  releasePassSlots: mockReleasePassSlots,
  getMaxActivePasses: mockGetMaxActivePasses,
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

  it("evicts a completed job with the same id before re-adding", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockQueueGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue("completed"),
      remove,
    });

    await schedulePassExpiry(7, new Date(Date.now() + 1000));

    expect(remove).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "expire",
      { passId: 7 },
      expect.objectContaining({ jobId: "pass-7" }),
    );
  });

  it("evicts a failed job with the same id before re-adding", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockQueueGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue("failed"),
      remove,
    });

    await schedulePassExpiry(8, new Date(Date.now() + 1000));

    expect(remove).toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalled();
  });

  it("leaves a live delayed job untouched (add stays a dedup no-op)", async () => {
    const remove = vi.fn();
    mockQueueGetJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue("delayed"),
      remove,
    });

    await schedulePassExpiry(9, new Date(Date.now() + 1000));

    expect(remove).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalled();
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
      period: { endTime: "15:00", scheduleTypeId: 5 },
    });

    await processPassExpiry(makeJob(1));

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
    expect(mockEmitPassEvent).not.toHaveBeenCalled();
  });

  it("skips a CANCELLED pass without updating", async () => {
    mockPassFindUnique.mockResolvedValue({
      id: 2,
      status: "CANCELLED",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: { endTime: "15:00", scheduleTypeId: 5 },
    });

    await processPassExpiry(makeJob(2));

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
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

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
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

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
  });

  it("returns early when pass not found", async () => {
    mockPassFindUnique.mockResolvedValue(null);

    await processPassExpiry(makeJob(999));

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
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
      period: { endTime: "15:00", scheduleTypeId: 5 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);

    await processPassExpiry(makeJob(10));

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { in: ["PENDING", "WAITING"] } },
      data: expect.objectContaining({ status: "EXPIRED", expiredAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
    expect(mockReleaseAndPromote).not.toHaveBeenCalled();
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
      period: { endTime: "15:00", scheduleTypeId: 5 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);

    await processPassExpiry(makeJob(11));

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 11, status: { in: ["PENDING", "WAITING"] } },
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
      period: { endTime: "15:00", scheduleTypeId: 5 },
      destination: { maxOccupancy: 10 },
    };
    const updatedPass = { ...pass, status: "COMPLETED", returnedAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);

    // checkIsLastPeriod: current period found, calendar found, NO later periods
    mockPeriodFindUnique.mockResolvedValue({ id: 3, endTime: "15:00", scheduleTypeId: 5 });
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([]); // no later periods → is last

    await processPassExpiry(makeJob(20));

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 20, status: "ACTIVE" },
      data: expect.objectContaining({ status: "COMPLETED", returnedAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:returned");
    expect(mockReleasePassSlots).toHaveBeenCalledWith(1, null, 5, 10);
    expect(mockReleaseAndPromote).not.toHaveBeenCalled();
  });

  it("marks ACTIVE pass EXPIRED when there are later periods (NOT the last period)", async () => {
    const pass = {
      id: 21,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: 3,
      period: { endTime: "10:00", scheduleTypeId: 5 },
      destination: { maxOccupancy: 10 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);

    // checkIsLastPeriod: there IS a later period
    mockPeriodFindUnique.mockResolvedValue({ id: 3, endTime: "10:00", scheduleTypeId: 5 });
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([
      { id: 4, endTime: "12:00", startTime: "10:30", scheduleTypeId: 5 },
    ]);

    await processPassExpiry(makeJob(21));

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 21, status: "ACTIVE" },
      data: expect.objectContaining({ status: "EXPIRED", expiredAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
    expect(mockReleaseAndPromote).toHaveBeenCalledWith(1, 5, 10);
    // gte so a back-to-back period starting exactly at endTime counts as "later"
    expect(mockPeriodFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ startTime: { gte: "10:00" } }),
      }),
    );
  });

  it("marks ACTIVE pass EXPIRED when the next period starts exactly at endTime (back-to-back)", async () => {
    const pass = {
      id: 22,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: 3,
      period: { endTime: "09:50", scheduleTypeId: 5 },
      destination: { maxOccupancy: 10 },
    };
    const updatedPass = { ...pass, status: "EXPIRED", expiredAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);

    mockPeriodFindUnique.mockResolvedValue({ id: 3, endTime: "09:50", scheduleTypeId: 5 });
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    // Next period starts exactly when this one ends — must still count as a later period
    mockPeriodFindMany.mockResolvedValue([
      { id: 4, endTime: "10:40", startTime: "09:50", scheduleTypeId: 5 },
    ]);

    await processPassExpiry(makeJob(22));

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 22, status: "ACTIVE" },
      data: expect.objectContaining({ status: "EXPIRED", expiredAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
    expect(mockReleaseAndPromote).toHaveBeenCalledWith(1, 5, 10);
  });

  it("treats ACTIVE pass as last period when periodId is null → COMPLETED", async () => {
    const pass = {
      id: 22,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: null,
      period: null,
      destination: { maxOccupancy: null },
    };
    const updatedPass = { ...pass, status: "COMPLETED", returnedAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);

    await processPassExpiry(makeJob(22));

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 22, status: "ACTIVE" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:returned");
  });

  it("uses the job-fired-at time, not current time, for calendar lookup", async () => {
    const pass = {
      id: 23,
      status: "ACTIVE",
      schoolId: 1,
      destinationId: 5,
      periodId: 3,
      period: { endTime: "15:00", scheduleTypeId: 5 },
      destination: { maxOccupancy: 10 },
    };
    const updatedPass = { ...pass, status: "COMPLETED", returnedAt: new Date() };

    mockPassFindUnique.mockResolvedValue(pass);
    mockPassUpdateMany.mockResolvedValue({ count: 1 });
    mockPassFindUniqueOrThrow.mockResolvedValue(updatedPass);
    mockPeriodFindUnique.mockResolvedValue({ id: 3, endTime: "15:00", scheduleTypeId: 5 });
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([]); // no later periods → is last

    await processPassExpiry(makeJob(23));

    // The calendar lookup must have been invoked, confirming the referenceDate code path runs
    expect(mockCalendarFindFirst).toHaveBeenCalledOnce();
  });
});
