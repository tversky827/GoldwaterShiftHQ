import { describe, expect, it } from "vitest";
import { addDaysStr, dayOfWeek, localDate, weekStartOf, zonedToUtc } from "@/lib/tz";

describe("time zones", () => {
  it("converts facility wall-clock times to UTC", () => {
    expect(zonedToUtc("2026-07-01", "07:00", "America/New_York").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedToUtc("2026-01-15", "07:00", "America/New_York").toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(zonedToUtc("2026-01-15", "07:00", "America/Chicago").toISOString()).toBe("2026-01-15T13:00:00.000Z");
    expect(zonedToUtc("2026-01-15", "07:00", "America/Phoenix").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
  it("handles DST transitions", () => {
    // 2026-03-08: 02:30 doesn't exist in New York -> 03:30 EDT
    expect(zonedToUtc("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // 2026-11-01: 01:30 happens twice -> first (EDT)
    expect(zonedToUtc("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // Night shift spanning fall-back is 9 hours long
    const start = zonedToUtc("2026-10-31", "23:00", "America/New_York");
    const end = zonedToUtc("2026-11-01", "07:00", "America/New_York");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(9);
  });
  it("date helpers", () => {
    expect(localDate(new Date("2026-11-26T03:00:00Z"), "America/Los_Angeles")).toBe("2026-11-25");
    expect(addDaysStr("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayOfWeek("2026-11-25")).toBe(3);
    expect(weekStartOf("2026-11-25", 0)).toBe("2026-11-22");
    expect(weekStartOf("2026-11-22", 0)).toBe("2026-11-22");
  });
});
