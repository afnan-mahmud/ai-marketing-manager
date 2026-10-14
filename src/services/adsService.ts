import { mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { format } from "date-fns";
import type { AppContext } from "../context.js";
import { normalizeExport, readTable } from "../sources/metaExport/parser.js";
import { listDates, shiftDate } from "../utils/dates.js";
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

export class AdsService {
  constructor(private readonly ctx: AppContext) {}

  /** Parses and (unless dryRun) upserts one export file. Does not move it. */
  importFile(filePath: string, dryRun = false): FileImportResult {
    const name = basename(filePath);
    try {
      const result = normalizeExport(readTable(filePath), name);
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

  /** Imports every CSV/XLSX in data/inbox/; successful files move to data/processed/YYYYMMDD-HHmm_<name>. */
  importFromFolder(dryRun = false) {
    const { inbox, processed } = this.ctx.paths;
    const files = listInboxFiles(inbox);
    if (files.length === 0) {
      return {
        summary:
          "No files in data/inbox/. Export from Ads Manager (Ads level, breakdown by Day) and drop the CSV/XLSX there.",
        dry_run: dryRun,
        files: [] as FileImportResult[],
        totals: { files: 0, rows_upserted: 0 },
      };
    }
    mkdirSync(processed, { recursive: true });
    const stamp = format(this.ctx.now(), "yyyyMMdd-HHmm");
    const results: FileImportResult[] = [];
    for (const f of files) {
      const r = this.importFile(join(inbox, f), dryRun);
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
