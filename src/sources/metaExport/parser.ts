import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { AdCreative, AdDailyRow, CreativeFormat, RawCounts } from "../../types/ads.js";
import { COUNT_FIELDS } from "../../types/ads.js";
import { toIsoDate } from "../../utils/dates.js";
import { ImportFormatError } from "../../utils/errors.js";
import { type CanonicalField, mapColumns, REQUIRED_FIELDS } from "./columnMap.js";

export interface RawTable {
  headers: string[];
  records: Record<string, unknown>[];
}

/** Reads a CSV or XLSX file into header + records (first worksheet for workbooks). */
export async function readTable(filePath: string): Promise<RawTable> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".csv") return parseCsv(readFileSync(filePath, "utf8"));
  if (ext === ".xlsx") return parseWorkbook(readFileSync(filePath));
  if (ext === ".xls") {
    throw new ImportFormatError(
      "Legacy .xls files aren't supported. Export as .xlsx or .csv from Ads Manager.",
    );
  }
  throw new ImportFormatError(`Unsupported file type "${ext}". Use .csv or .xlsx.`);
}

export function parseCsv(text: string): RawTable {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const fatal = result.errors.find(
    (e) => e.type === "Delimiter" || e.code === "UndetectableDelimiter",
  );
  if (fatal && result.data.length === 0)
    throw new ImportFormatError(`Could not parse CSV: ${fatal.message}`);
  return { headers: result.meta.fields ?? [], records: result.data };
}

/** Plain value of an ExcelJS cell (rich text, formulas and hyperlinks flattened). */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  // ExcelJS dates are UTC-based: take the UTC calendar day so negative time zones don't shift it.
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v !== "object") return v;
  if ("richText" in v) return v.richText.map((r) => r.text).join("");
  if ("result" in v) return v.result ?? "";
  if ("text" in v) return v.text;
  if ("error" in v) return "";
  return String(v);
}

export async function parseWorkbook(buf: Buffer): Promise<RawTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch (err) {
    throw new ImportFormatError(`Could not read the workbook: ${(err as Error).message}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportFormatError("Workbook has no sheets.");
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cellValue(cell.value) ?? "").trim();
  });
  const records: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) rec[h] = cellValue(row.getCell(i + 1).value);
    });
    records.push(rec);
  });
  return { headers, records };
}

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * Cleans Meta-export numbers: currency symbols (৳, $, Tk, BDT…), thousands separators, Bengali digits,
 * decimal commas, and placeholders ("—", "-", "", "n/a") → 0.
 */
export function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  s = s.replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)));
  if (/^(—|–|-|n\/a|na|none|null)$/i.test(s)) return 0;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d.,-]/g, ""));
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return 0;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Only commas: thousands if groups of 3 (incl. South Asian 1,23,456), else a decimal comma.
    s =
      /^\d{1,3}(,\d{2,3})+$/.test(s) && !/^\d+,\d{1,2}$/.test(s)
        ? s.replace(/,/g, "")
        : s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export interface DateParseState {
  ambiguousSlashDates: boolean;
}

/** Excel serial date → ISO. */
function fromExcelSerial(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parses export dates: ISO, YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY (ambiguous → US), Date objects, Excel serials. */
export function parseDate(value: unknown, state?: DateParseState): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toIsoDate(value);
  if (typeof value === "number")
    return value > 20000 && value < 80000 ? fromExcelSerial(value) : null;
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = +m[3]!;
    if (a > 12) return iso(y, b, a); // D/M/Y
    if (b > 12) return iso(y, a, b); // M/D/Y
    if (state && a !== b) state.ambiguousSlashDates = true;
    return iso(y, a, b); // ambiguous: assume Ads Manager's US default M/D/Y
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : toIsoDate(new Date(t));
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function hashId(prefix: string, ...parts: (string | null | undefined)[]): string {
  return `${prefix}${createHash("sha1")
    .update(parts.map((p) => (p ?? "").trim().toLowerCase()).join("|"))
    .digest("hex")
    .slice(0, 16)}`;
}

export function normalizeFormat(value: string | null): CreativeFormat {
  if (!value) return "unknown";
  const v = value.toLowerCase();
  if (/carousel|multi/.test(v)) return "carousel";
  if (/video|reel|thruplay/.test(v)) return "video";
  if (/image|photo|static|single/.test(v)) return "image";
  return "unknown";
}

export interface NormalizeResult {
  rows: AdDailyRow[];
  creatives: AdCreative[];
  warnings: string[];
  rows_read: number;
  rows_skipped: number;
  date_min: string | null;
  date_max: string | null;
  currency: string | null;
  columns: { mapped: Partial<Record<CanonicalField, string>>; ignored: string[] };
}

/** Converts raw export records into canonical ad_daily rows (throws ImportFormatError on missing columns). */
export function normalizeExport(table: RawTable, fileName = "export"): NormalizeResult {
  const mapping = mapColumns(table.headers);
  const f = mapping.fields;

  const missing = REQUIRED_FIELDS.filter(
    (r) => !f[r.field] && !(r.alternatives ?? []).some((a) => f[a]),
  );
  if (missing.length > 0) {
    throw new ImportFormatError(
      `${fileName}: missing required column(s): ${missing.map((m) => m.label).join(", ")}. ` +
        `Columns found: ${table.headers.filter(Boolean).join(", ") || "(none)"}.`,
    );
  }

  const warnings: string[] = [];
  if (mapping.ignored.length > 0)
    warnings.push(`Ignored unknown columns: ${mapping.ignored.join(", ")}`);
  const hasDay = Boolean(f.date);
  if (!hasDay) {
    warnings.push(
      "No 'Day' column: each row was imported with date = reporting end date, so daily trends won't be available. Export with breakdown 'By Time > Day' for trends.",
    );
  }

  const get = (rec: Record<string, unknown>, field: CanonicalField): unknown => {
    const header = f[field];
    return header === undefined ? undefined : rec[header];
  };
  const str = (rec: Record<string, unknown>, field: CanonicalField): string | null => {
    const v = get(rec, field);
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s && s !== "—" && s !== "-" ? s : null;
  };

  const dateState: DateParseState = { ambiguousSlashDates: false };
  const merged = new Map<string, AdDailyRow>();
  const creatives = new Map<string, AdCreative>();
  let skipped = 0;
  let mergedCount = 0;
  let resultsMapped = 0;
  let badDates = 0;

  for (const rec of table.records) {
    const adName = str(rec, "ad_name");
    const adIdRaw = str(rec, "ad_id");
    if (!adName && !adIdRaw) {
      skipped++; // blank or "Total" summary rows
      continue;
    }
    const date = parseDate(hasDay ? get(rec, "date") : get(rec, "reporting_end"), dateState);
    if (!date) {
      badDates++;
      skipped++;
      continue;
    }
    const campaignName = str(rec, "campaign_name");
    const adsetName = str(rec, "adset_name");
    const adId = adIdRaw ?? hashId("h_", campaignName, adsetName, adName);

    const counts = {} as RawCounts;
    for (const field of COUNT_FIELDS) counts[field] = parseNumber(get(rec, field));

    // "Results" fills a conversion only when its indicator names it and that column is absent/empty on this row.
    const results = parseNumber(get(rec, "result_count"));
    const indicator = (str(rec, "result_indicator") ?? "").toLowerCase();
    if (results > 0 && indicator) {
      const target: keyof RawCounts | null = /purchase/.test(indicator)
        ? "purchases"
        : /lead/.test(indicator)
          ? "leads"
          : /messag|conversation/.test(indicator)
            ? "messages"
            : null;
      if (target && counts[target] === 0) {
        counts[target] = results;
        resultsMapped++;
      }
    }

    const row: AdDailyRow = {
      date,
      ad_id: adId,
      ad_name: adName,
      adset_id: str(rec, "adset_id"),
      adset_name: adsetName,
      campaign_id: str(rec, "campaign_id"),
      campaign_name: campaignName,
      objective: str(rec, "objective"),
      source: "export",
      ...counts,
    };

    const key = `${date}|${adId}`;
    const existing = merged.get(key);
    if (existing) {
      mergedCount++;
      for (const k of COUNT_FIELDS) existing[k] += row[k];
    } else {
      merged.set(key, row);
    }

    const headline = str(rec, "headline");
    const primaryText = str(rec, "primary_text");
    const cta = str(rec, "cta");
    const format = str(rec, "format");
    const landing = str(rec, "landing_url");
    const thumb = str(rec, "thumbnail_url");
    if (headline || primaryText || cta || format || landing || thumb) {
      creatives.set(adId, {
        ad_id: adId,
        headline,
        primary_text: primaryText,
        cta,
        format: normalizeFormat(format),
        thumbnail_url: thumb,
        landing_url: landing,
      });
    }
  }

  if (resultsMapped > 0)
    warnings.push(
      `Mapped the 'Results' column to conversions on ${resultsMapped} row(s) using its result indicator.`,
    );
  if (mergedCount > 0) {
    warnings.push(
      `${mergedCount} duplicate (day, ad) rows were summed — the export probably has extra breakdowns (age, placement…). Reach/frequency may be overstated.`,
    );
  }
  if (badDates > 0)
    warnings.push(`${badDates} row(s) skipped because their date could not be read.`);
  if (dateState.ambiguousSlashDates) {
    warnings.push(
      "Dates like 03/04/2026 were read as month/day/year (Ads Manager default). Prefer YYYY-MM-DD exports.",
    );
  }

  const rows = [...merged.values()];
  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    creatives: [...creatives.values()],
    warnings,
    rows_read: table.records.length,
    rows_skipped: skipped,
    date_min: dates[0] ?? null,
    date_max: dates[dates.length - 1] ?? null,
    currency: mapping.currency,
    columns: { mapped: f, ignored: mapping.ignored },
  };
}
