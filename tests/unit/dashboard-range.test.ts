import { describe, expect, test } from "bun:test";

import { DashboardRangeError, resolveDashboardRange } from "../../src/lib/dashboard-range";

const now = new Date("2026-10-12T14:00:00.000Z");

describe("dashboard date ranges in America/Araguaina", () => {
  test("defaults to the trailing 30 local calendar days", () => {
    expect(resolveDashboardRange("30d", {}, now)).toEqual({
      startDate: "2026-09-13",
      endDate: "2026-10-12",
      startAt: "2026-09-13T03:00:00.000Z",
      endAtExclusive: "2026-10-13T03:00:00.000Z",
      days: 30,
    });
  });

  test.each([
    ["today", "2026-10-12", "2026-10-12", 1],
    ["yesterday", "2026-10-11", "2026-10-11", 1],
    ["7d", "2026-10-06", "2026-10-12", 7],
    ["thisMonth", "2026-10-01", "2026-10-12", 12],
    ["lastMonth", "2026-09-01", "2026-09-30", 30],
  ] as const)("resolves %s", (period, startDate, endDate, days) => {
    expect(resolveDashboardRange(period, {}, now)).toMatchObject({ startDate, endDate, days });
  });

  test("accepts inclusive custom dates", () => {
    expect(
      resolveDashboardRange("custom", { start: "2024-02-28", end: "2024-03-01" }, now),
    ).toEqual({
      startDate: "2024-02-28",
      endDate: "2024-03-01",
      startAt: "2024-02-28T03:00:00.000Z",
      endAtExclusive: "2024-03-02T03:00:00.000Z",
      days: 3,
    });
  });

  test.each([
    [{ start: "2026-02-30", end: "2026-03-01" }, "Data inicial invalida"],
    [{ start: "2026-03-01", end: "2026-02-28" }, "Data inicial deve anteceder"],
    [{ start: "2026-03-01" }, "Data final obrigatoria"],
    [{ end: "2026-03-01" }, "Data inicial obrigatoria"],
  ])("rejects invalid custom ranges", (range, message) => {
    expect(() => resolveDashboardRange("custom", range, now)).toThrow(
      new DashboardRangeError(message),
    );
  });
});
