import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { passStatusMock } from "../utils/passStatusMock.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockPassFindUnique,
  mockPassUpdateMany,
  mockPassFindUniqueOrThrow,
  mockPeriodFindMany,
  mockCalendarFindFirst,
  mockEmitPassEvent,
  mockReleaseAndPromote,
  mockReleasePassSlots,
  mockGetMaxActivePasses,
} = vi.hoisted(() => ({
  mockPassFindUnique: vi.fn(),
  mockPassUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  mockPassFindUniqueOrThrow: vi.fn(),
  mockPeriodFindMany: vi.fn(),
  mockCalendarFindFirst: vi.fn(),
  mockEmitPassEvent: vi.fn(),
  mockReleaseAndPromote: vi.fn().mockResolvedValue(undefined),
  mockReleasePassSlots: vi.fn().mockResolvedValue(undefined),
  mockGetMaxActivePasses: vi.fn().mockResolvedValue(null),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

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
      findMany: mockPeriodFindMany,
    },
    schoolCalendar: {
      findFirst: mockCalendarFindFirst,
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

import {
  scheduleLocalExpiry,
  expirePass,
  clearAllExpiryTimers,
} from "../../src/lib/expiry.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scheduleLocalExpiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // expirePass returns early after findUnique unless a test says otherwise
    mockPassFindUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    clearAllExpiryTimers();
    vi.useRealTimers();
  });

  it("arms a timer that expires the pass at fireAt", async () => {
    scheduleLocalExpiry(1, new Date(Date.now() + 60_000));
    expect(mockPassFindUnique).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockPassFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
  });

  it("fires ~immediately for a past fireAt (delay clamps to 0)", async () => {
    scheduleLocalExpiry(3, new Date(Date.now() - 1000));

    await vi.advanceTimersByTimeAsync(0);

    expect(mockPassFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 } }),
    );
  });

  it("re-arm replaces the prior timer (fires once, at the new time)", async () => {
    scheduleLocalExpiry(2, new Date(Date.now() + 60_000));
    scheduleLocalExpiry(2, new Date(Date.now() + 10_000));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockPassFindUnique).toHaveBeenCalledTimes(1);

    // Old 60s timer was cleared on re-arm — advancing past it fires nothing more
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPassFindUnique).toHaveBeenCalledTimes(1);
  });

  it("clearAllExpiryTimers cancels pending timers", async () => {
    scheduleLocalExpiry(4, new Date(Date.now() + 10_000));
    clearAllExpiryTimers();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(mockPassFindUnique).not.toHaveBeenCalled();
  });
});

describe("expirePass — terminal statuses", () => {
  it("skips a COMPLETED pass without updating", async () => {
    mockPassFindUnique.mockResolvedValue({
      id: 1,
      status: "COMPLETED",
      schoolId: 1,
      destinationId: 1,
      periodId: 2,
      period: { endTime: "15:00", scheduleTypeId: 5 },
    });

    await expirePass(1);

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

    await expirePass(2);

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

    await expirePass(3);

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

    await expirePass(4);

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
  });

  it("returns early when pass not found", async () => {
    mockPassFindUnique.mockResolvedValue(null);

    await expirePass(999);

    expect(mockPassUpdateMany).not.toHaveBeenCalled();
    expect(mockEmitPassEvent).not.toHaveBeenCalled();
  });
});

describe("expirePass — PENDING pass", () => {
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

    await expirePass(10);

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { in: ["PENDING", "WAITING"] } },
      data: expect.objectContaining({ status: "EXPIRED", expiredAt: expect.any(Date) }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
    expect(mockReleaseAndPromote).not.toHaveBeenCalled();
  });
});

describe("expirePass — WAITING pass", () => {
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

    await expirePass(11);

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 11, status: { in: ["PENDING", "WAITING"] } },
      data: expect.objectContaining({ status: "EXPIRED" }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:expired");
  });
});

describe("expirePass — ACTIVE pass", () => {
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
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([]); // no later periods → is last

    await expirePass(20);

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
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([
      { id: 4, endTime: "12:00", startTime: "10:30", scheduleTypeId: 5 },
    ]);

    await expirePass(21);

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

    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    // Next period starts exactly when this one ends — must still count as a later period
    mockPeriodFindMany.mockResolvedValue([
      { id: 4, endTime: "10:40", startTime: "09:50", scheduleTypeId: 5 },
    ]);

    await expirePass(22);

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

    await expirePass(22);

    expect(mockPassUpdateMany).toHaveBeenCalledWith({
      where: { id: 22, status: "ACTIVE" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    expect(mockEmitPassEvent).toHaveBeenCalledWith(updatedPass, "pass:returned");
  });

  it("uses the fired-at time, not current time, for calendar lookup", async () => {
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
    mockCalendarFindFirst.mockResolvedValue({ id: 1, schoolId: 1, scheduleTypeId: 5 });
    mockPeriodFindMany.mockResolvedValue([]); // no later periods → is last

    await expirePass(23);

    // The calendar lookup must have been invoked, confirming the referenceDate code path runs
    expect(mockCalendarFindFirst).toHaveBeenCalledOnce();
  });
});
