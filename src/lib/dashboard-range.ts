import type { DashboardPeriod } from "./dashboard-types";

const timeZone = "America/Araguaina";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type DashboardRangeInput = { start?: string; end?: string };

export type ResolvedDashboardRange = {
  startDate: string;
  endDate: string;
  startAt: string;
  endAtExclusive: string;
  days: number;
};

export class DashboardRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardRangeError";
  }
}

function dateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function formatDate(value: Date) {
  const { year, month, day } = dateParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dashboardLocalDate(value = new Date()) {
  return formatDate(value);
}

function parseDate(value: string | undefined, label: string) {
  if (!value) throw new DashboardRangeError(`${label} obrigatoria`);
  if (!datePattern.test(value)) throw new DashboardRangeError(`${label} invalida`);
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new DashboardRangeError(`${label} invalida`);
  }
  return parsed;
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function trailingStartDate(value = new Date()) {
  const localToday = parseDate(dashboardLocalDate(value), "Data atual");
  return isoDate(addDays(localToday, -29));
}

function zonedMidnight(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const localAsUtc = Date.UTC(year, month, day);
  let candidate = localAsUtc;
  for (let index = 0; index < 2; index += 1) {
    const parts = dateParts(new Date(candidate));
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = localAsUtc - (representedAsUtc - candidate);
  }
  return new Date(candidate);
}

export function resolveDashboardRange(
  period: DashboardPeriod,
  range: DashboardRangeInput = {},
  now = new Date(),
): ResolvedDashboardRange {
  const today = parseDate(formatDate(now), "Data atual");
  let start: Date;
  let end: Date;

  if (period === "custom") {
    start = parseDate(range.start, "Data inicial");
    end = parseDate(range.end, "Data final");
    if (start > end) {
      throw new DashboardRangeError("Data inicial deve anteceder");
    }
  } else if (period === "yesterday") {
    start = addDays(today, -1);
    end = start;
  } else if (period === "thisMonth") {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    end = today;
  } else if (period === "lastMonth") {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  } else {
    const length = period === "today" ? 1 : period === "7d" ? 7 : 30;
    start = addDays(today, -(length - 1));
    end = today;
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
    startAt: zonedMidnight(start).toISOString(),
    endAtExclusive: zonedMidnight(addDays(end, 1)).toISOString(),
    days,
  };
}
