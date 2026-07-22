import { describe, it, expect, vi } from "vitest";
import { getCurrentTimeInTimezone } from "../src/time.js";

describe("getCurrentTimeInTimezone", () => {
  it("normalizes a '24:xx' formatter result to '00:xx' (ICU hour12:false midnight quirk)", () => {
    // format is an accessor property that returns a bound function — spy on the getter
    const formatSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "format", "get")
      .mockReturnValue(() => "24:07");

    try {
      expect(getCurrentTimeInTimezone("UTC", new Date("2026-07-07T00:07:00Z"))).toBe("00:07");
    } finally {
      formatSpy.mockRestore();
    }
  });

  it("returns '00:00' at local midnight", () => {
    expect(getCurrentTimeInTimezone("UTC", new Date("2026-07-07T00:00:00Z"))).toBe("00:00");
  });
});
