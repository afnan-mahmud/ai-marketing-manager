import type { DB } from "../client.js";
import type { AdCreative, AdDailyRow, CreativeFormat } from "../../types/ads.js";
import type { DateRange } from "../../utils/dates.js";

export interface ImportLogEntry {
  source: string;
  file_name: string | null;
  rows_read: number;
  rows_upserted: number;
  date_min: string | null;
  date_max: string | null;
  warnings: string[];
}

export interface CoverageStats {
  date_min: string | null;
  date_max: string | null;
  days_with_data: number;
  ads: number;
  adsets: number;
  campaigns: number;
  rows: number;
  sources: { source: string; rows: number; date_min: string; date_max: string }[];
}

const DAILY_COLUMNS = [
  "date",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "objective",
  "spend",
  "impressions",
  "reach",
  "clicks_all",
  "link_clicks",
  "landing_page_views",
  "add_to_cart",
  "initiate_checkout",
  "purchases",
  "purchase_value",
  "leads",
  "messages",
  "video_3s_views",
  "video_thruplays",
  "source",
  "imported_at",
] as const;

export class AdsRepo {
  constructor(private readonly db: DB) {}

  /** UPSERT on (date, ad_id): re-imports overwrite, never duplicate. Returns rows written. */
  upsertDaily(rows: AdDailyRow[], importedAt = new Date().toISOString()): number {
    const placeholders = DAILY_COLUMNS.map((c) => `@${c}`).join(", ");
    const updates = DAILY_COLUMNS.filter((c) => c !== "date" && c !== "ad_id")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");
    const stmt = this.db.prepare(
      `INSERT INTO ad_daily (${DAILY_COLUMNS.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(date, ad_id) DO UPDATE SET ${updates}`,
    );
    const run = this.db.transaction((items: AdDailyRow[]) => {
      let n = 0;
      for (const r of items) n += stmt.run({ ...r, imported_at: importedAt }).changes;
      return n;
    });
    return run(rows);
  }

  upsertCreatives(creatives: AdCreative[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO ad_creatives (ad_id, headline, primary_text, cta, format, thumbnail_url, landing_url, updated_at)
       VALUES (@ad_id, @headline, @primary_text, @cta, @format, @thumbnail_url, @landing_url, @updated_at)
       ON CONFLICT(ad_id) DO UPDATE SET
         headline = COALESCE(excluded.headline, ad_creatives.headline),
         primary_text = COALESCE(excluded.primary_text, ad_creatives.primary_text),
         cta = COALESCE(excluded.cta, ad_creatives.cta),
         format = CASE WHEN excluded.format = 'unknown' THEN ad_creatives.format ELSE excluded.format END,
         thumbnail_url = COALESCE(excluded.thumbnail_url, ad_creatives.thumbnail_url),
         landing_url = COALESCE(excluded.landing_url, ad_creatives.landing_url),
         updated_at = excluded.updated_at`,
    );
    const now = new Date().toISOString();
    const run = this.db.transaction((items: AdCreative[]) => {
      let n = 0;
      for (const c of items) n += stmt.run({ ...c, updated_at: now }).changes;
      return n;
    });
    return run(creatives);
  }

  getDaily(range: DateRange): AdDailyRow[] {
    return this.db
      .prepare("SELECT * FROM ad_daily WHERE date BETWEEN ? AND ? ORDER BY date, ad_id")
      .all(range.since, range.until) as AdDailyRow[];
  }

  getDailyForAd(adId: string, range: DateRange): AdDailyRow[] {
    return this.db
      .prepare("SELECT * FROM ad_daily WHERE ad_id = ? AND date BETWEEN ? AND ? ORDER BY date")
      .all(adId, range.since, range.until) as AdDailyRow[];
  }

  /** First and last date each ad had spend (used for ad age / creative velocity). */
  getAdLifetimes(): { ad_id: string; first_date: string; last_date: string }[] {
    return this.db
      .prepare(
        "SELECT ad_id, MIN(date) AS first_date, MAX(date) AS last_date FROM ad_daily WHERE spend > 0 OR impressions > 0 GROUP BY ad_id",
      )
      .all() as { ad_id: string; first_date: string; last_date: string }[];
  }

  getCreatives(adIds: string[]): Map<string, AdCreative> {
    const out = new Map<string, AdCreative>();
    if (adIds.length === 0) return out;
    const stmt = this.db.prepare("SELECT * FROM ad_creatives WHERE ad_id = ?");
    for (const id of adIds) {
      const row = stmt.get(id) as (AdCreative & { format: CreativeFormat | null }) | undefined;
      if (row) out.set(id, { ...row, format: row.format ?? "unknown" });
    }
    return out;
  }

  lastDate(): string | null {
    const r = this.db.prepare("SELECT MAX(date) AS d FROM ad_daily").get() as { d: string | null };
    return r.d;
  }

  listDates(): string[] {
    return (
      this.db.prepare("SELECT DISTINCT date FROM ad_daily ORDER BY date").all() as {
        date: string;
      }[]
    ).map((r) => r.date);
  }

  coverage(): CoverageStats {
    const base = this.db
      .prepare(
        `SELECT MIN(date) AS date_min, MAX(date) AS date_max, COUNT(DISTINCT date) AS days_with_data,
                COUNT(DISTINCT ad_id) AS ads, COUNT(DISTINCT COALESCE(adset_id, adset_name)) AS adsets,
                COUNT(DISTINCT COALESCE(campaign_id, campaign_name)) AS campaigns, COUNT(*) AS rows
         FROM ad_daily`,
      )
      .get() as Omit<CoverageStats, "sources">;
    const sources = this.db
      .prepare(
        "SELECT source, COUNT(*) AS rows, MIN(date) AS date_min, MAX(date) AS date_max FROM ad_daily GROUP BY source",
      )
      .all() as CoverageStats["sources"];
    return { ...base, sources };
  }

  countRows(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM ad_daily").get() as { n: number }).n;
  }

  logImport(entry: ImportLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO import_log (source, file_name, rows_read, rows_upserted, date_min, date_max, warnings, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.source,
        entry.file_name,
        entry.rows_read,
        entry.rows_upserted,
        entry.date_min,
        entry.date_max,
        JSON.stringify(entry.warnings),
        new Date().toISOString(),
      );
  }

  recentImports(limit = 5): (ImportLogEntry & { created_at: string })[] {
    const rows = this.db
      .prepare("SELECT * FROM import_log ORDER BY id DESC LIMIT ?")
      .all(limit) as (Omit<ImportLogEntry, "warnings"> & {
      warnings: string;
      created_at: string;
    })[];
    return rows.map((r) => ({ ...r, warnings: JSON.parse(r.warnings || "[]") as string[] }));
  }
}
