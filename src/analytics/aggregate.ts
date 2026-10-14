import { createHash } from "node:crypto";
import type { AdDailyRow, Level, RawCounts } from "../types/ads.js";
import { emptyCounts, sumCounts } from "./metrics.js";
import { COUNT_FIELDS } from "../types/ads.js";

export interface EntityAggregate {
  level: Level;
  id: string;
  name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  counts: RawCounts;
  first_date: string;
  last_date: string;
  days_with_spend: number;
}

const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Stable id per entity: Meta id when present, otherwise derived from names. */
export function entityId(row: AdDailyRow, level: Level): string {
  if (level === "ad") return row.ad_id;
  if (level === "adset") {
    return row.adset_id ?? `n_${shortHash(`${row.campaign_name ?? ""}|${row.adset_name ?? ""}`)}`;
  }
  return row.campaign_id ?? `n_${shortHash(row.campaign_name ?? "")}`;
}

export function entityName(row: AdDailyRow, level: Level): string {
  const n = level === "ad" ? row.ad_name : level === "adset" ? row.adset_name : row.campaign_name;
  return n ?? "(unnamed)";
}

/** Groups daily rows by campaign/adset/ad, summing raw counts. */
export function aggregateBy(rows: readonly AdDailyRow[], level: Level): EntityAggregate[] {
  const map = new Map<string, EntityAggregate & { _days: Set<string> }>();
  for (const r of rows) {
    const id = entityId(r, level);
    let e = map.get(id);
    if (!e) {
      e = {
        level,
        id,
        name: entityName(r, level),
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        adset_id: level === "campaign" ? null : r.adset_id,
        adset_name: level === "campaign" ? null : r.adset_name,
        counts: emptyCounts(),
        first_date: r.date,
        last_date: r.date,
        days_with_spend: 0,
        _days: new Set(),
      };
      map.set(id, e);
    }
    for (const f of COUNT_FIELDS) e.counts[f] += r[f];
    if (r.date < e.first_date) e.first_date = r.date;
    if (r.date > e.last_date) e.last_date = r.date;
    if (r.spend > 0) e._days.add(r.date);
  }
  return [...map.values()].map(({ _days, ...e }) => ({ ...e, days_with_spend: _days.size }));
}

export function filterByEntity(
  rows: readonly AdDailyRow[],
  level: Level,
  id: string,
): AdDailyRow[] {
  return rows.filter((r) => entityId(r, level) === id);
}

/** Daily totals for every date in `dates` (missing days → zero counts). */
export function aggregateByDay(
  rows: readonly AdDailyRow[],
  dates: readonly string[],
): { date: string; counts: RawCounts }[] {
  const byDate = new Map<string, AdDailyRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  return dates.map((date) => ({ date, counts: sumCounts(byDate.get(date) ?? []) }));
}
