export const passStatusMock = {
  PENDING: "PENDING",
  WAITING: "WAITING",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  DENIED: "DENIED",
  EXPIRED: "EXPIRED",
} as const;

export const inFlightPassStatusesMock = [
  passStatusMock.PENDING,
  passStatusMock.WAITING,
  passStatusMock.ACTIVE,
];
