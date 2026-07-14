import { describe, it, expect, vi } from "vitest";
import { UserRole } from "@hallpass/types";
import { generatePinCode, createUserWithPin } from "../../src/lib/pin.js";

function pinConflict() {
  return { code: "P2002", meta: { target: ["pinCode"] } };
}

function emailConflict() {
  return { code: "P2002", meta: { target: ["email"] } };
}

describe("generatePinCode", () => {
  it("returns a 6-digit numeric string with no leading zero", () => {
    for (let i = 0; i < 500; i++) {
      const pin = generatePinCode();
      expect(pin).toMatch(/^[1-9]\d{5}$/);
    }
  });
});

describe("createUserWithPin", () => {
  it("passes a generated pinCode to the create fn for students", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });

    await createUserWithPin(UserRole.STUDENT, create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatch(/^[1-9]\d{5}$/);
  });

  it("passes undefined (no pin) for non-student roles", async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });

    await createUserWithPin(UserRole.TEACHER, create);

    expect(create).toHaveBeenCalledWith(undefined);
  });

  it("retries with a fresh pin on a pinCode conflict", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(pinConflict())
      .mockResolvedValueOnce({ id: 1 });

    await createUserWithPin(UserRole.STUDENT, create);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).not.toBe(create.mock.calls[1][0]);
  });

  it("propagates an email conflict without retrying", async () => {
    const create = vi.fn().mockRejectedValue(emailConflict());

    await expect(createUserWithPin(UserRole.STUDENT, create)).rejects.toMatchObject({
      code: "P2002",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retries on persistent pinCode conflicts", async () => {
    const create = vi.fn().mockRejectedValue(pinConflict());

    await expect(createUserWithPin(UserRole.STUDENT, create)).rejects.toThrow(
      /unique pinCode/,
    );
    expect(create).toHaveBeenCalledTimes(5);
  });
});
