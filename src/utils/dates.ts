import { addDays, differenceInCalendarDays, format, parseISO, startOfMonth } from "date-fns";
import { z } from "zod";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateSchema = z.string().regex(ISO_DATE, "Use YYYY-MM-DD");

export const periodPresets = [
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
] as const;
export type PeriodPreset = (typeof periodPresets)[number];

export const periodSchema = z.union([
  z.enum(periodPresets),
  z.object({ since: isoDateSchema, until: isoDateSchema }),
]);
export type Period = z.infer<typeof periodSchema>;

export interface DateRange {
  since: string;
  until: string;
}

export function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parseIsoDate(s: string): Date {
  return parseISO(s);
}

export function shiftDate(iso: string, days: number): string {
  return toIsoDate(addDays(parseISO(iso), days));
}

/** Inclusive number of days in a range. */
export function rangeLength(range: DateRange): number {
  return differenceInCalendarDays(parseISO(range.until), parseISO(range.since)) + 1;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return differenceInCalendarDays(parseISO(toIso), parseISO(fromIso));
}

export function listDates(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.since; d <= range.until; d = shiftDate(d, 1)) out.push(d);
  return out;
}

/**
 * Resolves a period relative to an anchor "today". "yesterday" = anchor - 1 day;
 * last_Nd = the N full days ending yesterday; this_month = 1st of the month until yesterday.
 */
export function resolvePeriod(period: Period, today: string): DateRange {
  if (typeof period === "object") {
    if (period.since > period.until)
      throw new RangeError("period.since must be on or before period.until");
    return { since: period.since, until: period.until };
  }
  const yesterday = shiftDate(today, -1);
  switch (period) {
    case "yesterday":
      return { since: yesterday, until: yesterday };
    case "last_7d":
      return { since: shiftDate(today, -7), until: yesterday };
    case "last_14d":
      return { since: shiftDate(today, -14), until: yesterday };
    case "last_30d":
      return { since: shiftDate(today, -30), until: yesterday };
    case "this_month": {
      const first = toIsoDate(startOfMonth(parseISO(yesterday)));
      return { since: first, until: yesterday };
    }
  }
}

/** The equal-length period immediately before `range`. */
export function previousPeriod(range: DateRange): DateRange {
  const len = rangeLength(range);
  return { since: shiftDate(range.since, -len), until: shiftDate(range.since, -1) };
}

export function describePeriod(period: Period): string {
  return typeof period === "object" ? `${period.since}..${period.until}` : period;
}
