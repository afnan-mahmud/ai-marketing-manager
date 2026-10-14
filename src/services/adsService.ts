import { mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { format } from "date-fns";
import type { AppContext } from "../context.js";
import { MetaApiClient } from "../sources/metaApi/client.js";
import { fetchCreatives } from "../sources/metaApi/creatives.js";
import { fetchDailyInsights } from "../sources/metaApi/insights.js";
import { normalizeExport, readTable } from "../sources/metaExport/parser.js";
import { listDates, rangeLength, shiftDate, type DateRange } from "../utils/dates.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { listInboxFiles } from "./setupService.js";

export interface FileImportResult {
  file: string;
  status: "imported" | "dry_run" | "failed";
  rows_read: number;
  rows_upserted: number;
  rows_skipped: number;
  date_min: string | null;
  date_max: string | null;
  creatives: number;
  currency_in_file: string | null;
  warnings: string[];
  error?: string;
  hint?: string;
  moved_to?: string;
}

/** Default API window: re-pull the last 7 days because attribution keeps updating. */
export const DEFAULT_SYNC_DAYS = 7;
const MAX_SYNC_DAYS = 93;

export class AdsService {
  constructor(private readonly ctx: AppContext) {}

  metaClient(token = this.ctx.env.META_ACCESS_TOKEN): MetaApiClient {
    if (!token) {
      throw new AppError(
        "The Meta Marketing API is not configured.",
        "Set META_ACCESS_TOKEN (ads_read; ads_management if this project manages ads) in the global .env or this project's project.env, and the ad account with configure_project_meta — or use folder import (projects/<project>/inbox/) instead.",
      );
    }
    return new MetaApiClient({
      token,
      version: this.ctx.env.META_API_VERSION,
      fetch: this.ctx.fetch,
      sleep: this.ctx.sleep,
    });
  }

  /** Pulls daily ad-level insights + creatives from the Marketing API into the same tables as exports. */
  async syncFromMeta(since?: string, until?: string) {
    const accountId = this.ctx.env.META_AD_ACCOUNT_ID;
    const client = this.metaClient();
    if (!accountId) {
      throw new AppError(
        "META_AD_ACCOUNT_ID is not set.",
        "Set this client's ad account with configure_project_meta (numeric id, without act_). Each project has its own ad account.",
      );
    }
    const today = this.ctx.today();
    const range: DateRange = {
      since: since ?? shiftDate(today, -DEFAULT_SYNC_DAYS),
      until: until ?? shiftDate(today, -1),
    };
    if (range.since > range.until) throw new AppError("since must be on or before until.");
    if (rangeLength(range) > MAX_SYNC_DAYS) {
      throw new AppError(
        `Sync at most ${MAX_SYNC_DAYS} days per call.`,
        "Split the range into several calls.",
      );
    }

    const rows = await fetchDailyInsights(client, accountId, range);
    const upserted = this.ctx.repos.ads.upsertDaily(rows);
    const warnings: string[] = [];
    const adIds = [...new Set(rows.map((r) => r.ad_id))];
    let creatives = 0;
    try {
      const fetched = await fetchCreatives(client, adIds);
      creatives = this.ctx.repos.ads.upsertCreatives(fetched);
    } catch (err) {
      warnings.push(
        `Insights synced, but creatives could not be fetched: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const exportOverlap = this.ctx.repos.ads
      .getDaily(range)
      .filter((r) => r.source === "export" && r.ad_id.startsWith("h_")).length;
    if (exportOverlap > 0) {
      warnings.push(
        `${exportOverlap} row(s) in this range came from exports without Ad IDs and will be double-counted alongside API data. Re-export with the "Ad ID" column, or use only one source for a date range.`,
      );
    }
    if (rows.length === 0)
      warnings.push(
        "Meta returned no rows: the account had no delivery in this range, or the token can't see it.",
      );
    this.ctx.repos.ads.logImport({
      source: "api",
      file_name: null,
      rows_read: rows.length,
      rows_upserted: upserted,
      date_min: range.since,
      date_max: range.until,
      warnings,
    });
    return {
      summary: `Synced ${rows.length} daily ad row(s) for ${range.since}..${range.until} from act_${accountId} (${adIds.length} ads, ${creatives} creatives).`,
      range,
      rows: rows.length,
      rows_upserted: upserted,
      ads: adIds.length,
      creatives_updated: creatives,
      warnings,
      data_last_date: this.ctx.repos.ads.lastDate(),
    };
  }

  /** Parses and (unless dryRun) upserts one export file. Does not move it. */
  async importFile(filePath: string, dryRun = false): Promise<FileImportResult> {
    const name = basename(filePath);
    try {
      const result = normalizeExport(await readTable(filePath), name);
      const warnings = [...result.warnings];
      const bizCurrency = this.ctx.business.tryLoad()?.business.currency;
      if (result.currency && bizCurrency && result.currency !== bizCurrency) {
        warnings.push(
          `File currency ${result.currency} differs from business.yaml currency ${bizCurrency}.`,
        );
      }
      let upserted = 0;
      if (!dryRun) {
        upserted = this.ctx.repos.ads.upsertDaily(result.rows);
        this.ctx.repos.ads.upsertCreatives(result.creatives);
        this.ctx.repos.ads.logImport({
          source: "export",
          file_name: name,
          rows_read: result.rows_read,
          rows_upserted: upserted,
          date_min: result.date_min,
          date_max: result.date_max,
          warnings,
        });
      }
      return {
        file: name,
        status: dryRun ? "dry_run" : "imported",
        rows_read: result.rows_read,
        rows_upserted: dryRun ? result.rows.length : upserted,
        rows_skipped: result.rows_skipped,
        date_min: result.date_min,
        date_max: result.date_max,
        creatives: result.creatives.length,
        currency_in_file: result.currency,
        warnings,
      };
    } catch (err) {
      if (!(err instanceof AppError)) logger.error(`Import of ${name} failed`, err);
      return {
        file: name,
        status: "failed",
        rows_read: 0,
        rows_upserted: 0,
        rows_skipped: 0,
        date_min: null,
        date_max: null,
        creatives: 0,
        currency_in_file: null,
        warnings: [],
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof AppError && err.hint ? { hint: err.hint } : {}),
      };
    }
  }

  /** Imports every CSV/XLSX in projects/<project>/inbox/; successful files move to projects/<project>/processed/YYYYMMDD-HHmm_<name>. */
  async importFromFolder(dryRun = false) {
    const { inbox, processed } = this.ctx.paths;
    const files = listInboxFiles(inbox);
    if (files.length === 0) {
      return {
        summary:
          "No files in projects/<project>/inbox/. Export from Ads Manager (Ads level, breakdown by Day) and drop the CSV/XLSX there.",
        dry_run: dryRun,
        files: [] as FileImportResult[],
        totals: { files: 0, rows_upserted: 0 },
      };
    }
    mkdirSync(processed, { recursive: true });
    const stamp = format(this.ctx.now(), "yyyyMMdd-HHmm");
    const results: FileImportResult[] = [];
    for (const f of files) {
      const r = await this.importFile(join(inbox, f), dryRun);
      if (r.status === "imported") {
        const target = join(processed, `${stamp}_${f}`);
        renameSync(join(inbox, f), target);
        r.moved_to = target;
      }
      results.push(r);
    }
    const ok = results.filter((r) => r.status !== "failed");
    const failed = results.length - ok.length;
    const rows = ok.reduce((s, r) => s + r.rows_upserted, 0);
    const dates = ok
      .flatMap((r) => [r.date_min, r.date_max])
      .filter((d): d is string => !!d)
      .sort();
    return {
      summary: `${dryRun ? "Dry run: would import" : "Imported"} ${rows} row(s) from ${ok.length} file(s)${failed ? `; ${failed} failed` : ""}${dates.length ? ` covering ${dates[0]}..${dates[dates.length - 1]}` : ""}.`,
      dry_run: dryRun,
      files: results,
      totals: {
        files: results.length,
        imported: ok.length,
        failed,
        rows_upserted: rows,
        date_min: dates[0] ?? null,
        date_max: dates[dates.length - 1] ?? null,
      },
      data_last_date: this.ctx.repos.ads.lastDate(),
    };
  }

  coverage() {
    const stats = this.ctx.repos.ads.coverage();
    if (!stats.date_min || !stats.date_max) {
      return {
        summary: "No ad data stored yet.",
        ...stats,
        gaps: [],
      };
    }
    const have = new Set(this.ctx.repos.ads.listDates());
    const gaps: { since: string; until: string; days: number }[] = [];
    let gapStart: string | null = null;
    let prev: string | null = null;
    for (const d of listDates({ since: stats.date_min, until: stats.date_max })) {
      if (!have.has(d)) {
        if (!gapStart) gapStart = d;
      } else if (gapStart && prev) {
        gaps.push({
          since: gapStart,
          until: prev,
          days: listDates({ since: gapStart, until: prev }).length,
        });
        gapStart = null;
      }
      prev = d;
    }
    const today = this.ctx.today();
    const staleDays = listDates({
      since: shiftDate(stats.date_max, 1),
      until: shiftDate(today, -1),
    }).length;
    return {
      summary: `${stats.days_with_data} day(s) of data ${stats.date_min}..${stats.date_max}, ${stats.ads} ads in ${stats.campaigns} campaigns${gaps.length ? `, ${gaps.length} gap(s)` : ""}.`,
      ...stats,
      gaps,
      days_missing_until_yesterday: staleDays,
      recent_imports: this.ctx.repos.ads.recentImports(5),
    };
  }
}
