import { copyFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { mapColumns, normalizeHeader } from "../../src/sources/metaExport/columnMap.js";
import {
  normalizeExport,
  parseDate,
  parseNumber,
  readTable,
} from "../../src/sources/metaExport/parser.js";
import { ImportFormatError } from "../../src/utils/errors.js";
import { createTestContext, SAMPLE_CSV } from "../helpers/context.js";

const fixture = (n: string) => join(import.meta.dirname, "..", "fixtures", n);

describe("parseNumber", () => {
  it.each([
    ["1,250.50", 1250.5],
    ["৳12,345.67", 12345.67],
    ["Tk 5,000", 5000],
    ["$400.00", 400],
    ["১,২৩,৪৫৬", 123456],
    ["1.234,56", 1234.56],
    ["12,5", 12.5],
    ["—", 0],
    ["-", 0],
    ["", 0],
    [null, 0],
    [42, 42],
  ])("%s → %s", (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected as number);
  });
});

describe("parseDate", () => {
  it("handles ISO, slashes, D/M/Y, Excel serials and Date objects", () => {
    expect(parseDate("2026-10-01")).toBe("2026-10-01");
    expect(parseDate("2026/10/01")).toBe("2026-10-01");
    expect(parseDate("25/10/2026")).toBe("2026-10-25");
    expect(parseDate("10/25/2026")).toBe("2026-10-25");
    expect(parseDate(46296)).toBe("2026-10-01");
    expect(parseDate(new Date(2026, 9, 1))).toBe("2026-10-01");
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("column mapping", () => {
  it("strips currency suffix but keeps (all)", () => {
    expect(normalizeHeader("Amount spent (BDT)")).toEqual({
      normalized: "amount spent",
      currency: "BDT",
    });
    const m = mapColumns([
      "Clicks (all)",
      "Link clicks",
      "Amount spent (USD)",
      "CTR (link click-through rate)",
      "Weird",
    ]);
    expect(m.fields.clicks_all).toBe("Clicks (all)");
    expect(m.fields.link_clicks).toBe("Link clicks");
    expect(m.fields.spend).toBe("Amount spent (USD)");
    expect(m.currency).toBe("USD");
    expect(m.derivedIgnored).toContain("CTR (link click-through rate)");
    expect(m.ignored).toEqual(["Weird"]);
  });
});

describe("normalizeExport header variants", () => {
  it("variant A: Ads Manager default columns, creatives, summary row skipped", async () => {
    const r = normalizeExport(await readTable(fixture("export-variant-a.csv")), "a.csv");
    expect(r.rows).toHaveLength(3);
    expect(r.rows_skipped).toBe(1);
    expect(r.currency).toBe("BDT");
    const first = r.rows.find((x) => x.ad_name === "Video Ad" && x.date === "2026-10-01")!;
    expect(first.spend).toBe(1250.5);
    expect(first.video_3s_views).toBe(3000);
    expect(first.ad_id).toMatch(/^h_/);
    expect(r.creatives.find((c) => c.ad_id === first.ad_id)?.format).toBe("video");
    expect(r.date_min).toBe("2026-10-01");
    expect(r.date_max).toBe("2026-10-02");
  });

  it("variant B: ids, alternative names, $ amounts, em-dash, unknown column warning", async () => {
    const r = normalizeExport(await readTable(fixture("export-variant-b.csv")), "b.csv");
    expect(r.rows).toHaveLength(3);
    const b1 = r.rows.find((x) => x.ad_id === "333" && x.date === "2026-10-02")!;
    expect(b1.spend).toBe(410);
    expect(b1.purchases).toBe(3);
    expect(b1.purchase_value).toBe(3600);
    expect(b1.link_clicks).toBe(62);
    expect(b1.campaign_id).toBe("111");
    const b2 = r.rows.find((x) => x.ad_id === "334")!;
    expect(b2.purchases).toBe(0);
    expect(b2.leads).toBe(1);
    expect(r.warnings.join(" ")).toContain("Some Custom Column");
    expect(r.warnings.join(" ")).not.toContain("CPM");
  });

  it("variant C: no Day column, Results mapped via indicator, Bengali digits and ৳", async () => {
    const r = normalizeExport(await readTable(fixture("export-variant-c.csv")), "c.csv");
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((x) => x.date === "2026-10-07")).toBe(true);
    const chat = r.rows.find((x) => x.ad_name === "Chat Ad")!;
    expect(chat.spend).toBeCloseTo(12345.67);
    expect(chat.impressions).toBe(123456);
    expect(chat.messages).toBe(40);
    const lead = r.rows.find((x) => x.ad_name === "Lead Ad")!;
    expect(lead.leads).toBe(25);
    expect(r.warnings.some((w) => w.includes("No 'Day' column"))).toBe(true);
  });

  it("rejects a malformed file listing what it found", async () => {
    const table = await readTable(fixture("export-malformed.csv"));
    expect(() => normalizeExport(table, "bad.csv")).toThrow(ImportFormatError);
    try {
      normalizeExport(table, "bad.csv");
    } catch (e) {
      expect((e as Error).message).toContain("Amount spent");
      expect((e as Error).message).toContain(
        "Columns found: Day, Campaign name, Ad name, Impressions, Clicks",
      );
    }
  });

  it("sums duplicate (day, ad) rows from extra breakdowns", () => {
    const table = {
      headers: ["Day", "Ad name", "Age", "Amount spent", "Impressions"],
      records: [
        {
          Day: "2026-10-01",
          "Ad name": "X",
          Age: "18-24",
          "Amount spent": "10",
          Impressions: "100",
        },
        {
          Day: "2026-10-01",
          "Ad name": "X",
          Age: "25-34",
          "Amount spent": "15",
          Impressions: "200",
        },
      ],
    };
    const r = normalizeExport(table);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.spend).toBe(25);
    expect(r.rows[0]!.impressions).toBe(300);
    expect(r.warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  it("reads XLSX workbooks (dates, formulas) and rejects legacy .xls", async () => {
    const ctx = createTestContext();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRows([
      [
        "Day",
        "Campaign name",
        "Ad set name",
        "Ad name",
        "Amount spent (BDT)",
        "Impressions",
        "Purchases",
      ],
      [new Date(Date.UTC(2026, 9, 1)), "C", "S", "A", 100.5, 1000, 2],
      ["2026-10-02", "C", "S", "A", { formula: "100*2", result: 200 }, 2000, 1],
    ]);
    const file = join(ctx.paths.inbox, "export.xlsx");
    await wb.xlsx.writeFile(file);
    const r = normalizeExport(await readTable(file), "export.xlsx");
    expect(r.rows.map((x) => x.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(r.rows[0]!.spend).toBe(100.5);
    expect(r.rows[1]!.purchases).toBe(1);
    expect(r.rows[1]!.spend).toBe(200);
    writeFileSync(join(ctx.paths.inbox, "old.xls"), "x");
    await expect(readTable(join(ctx.paths.inbox, "old.xls"))).rejects.toThrow(/xlsx or .csv/);
  });
});

describe("AdsService folder import", () => {
  it("is idempotent: importing the sample twice gives the same row count", async () => {
    const ctx = createTestContext({ business: "example" });
    copyFileSync(SAMPLE_CSV, join(ctx.paths.inbox, "sample.csv"));
    const first = await ctx.services.ads.importFromFolder();
    expect(first.totals.rows_upserted).toBe(333);
    expect(ctx.repos.ads.countRows()).toBe(333);
    expect(existsSync(join(ctx.paths.inbox, "sample.csv"))).toBe(false);
    expect(readdirSync(ctx.paths.processed)[0]).toMatch(/^20261014-0900_sample\.csv$/);

    copyFileSync(SAMPLE_CSV, join(ctx.paths.inbox, "sample-again.csv"));
    await ctx.services.ads.importFromFolder();
    expect(ctx.repos.ads.countRows()).toBe(333);
    const cov = ctx.services.ads.coverage();
    expect(cov.ads).toBe(12);
    expect(cov.campaigns).toBe(3);
    expect(cov.date_min).toBe("2026-09-14");
    expect(cov.date_max).toBe("2026-10-13");
    expect(cov.gaps).toEqual([]);
  });

  it("dry run neither writes nor moves files; failed files stay in the inbox", async () => {
    const ctx = createTestContext();
    copyFileSync(SAMPLE_CSV, join(ctx.paths.inbox, "sample.csv"));
    copyFileSync(fixture("export-malformed.csv"), join(ctx.paths.inbox, "bad.csv"));
    const dry = await ctx.services.ads.importFromFolder(true);
    expect(dry.totals.rows_upserted).toBe(333);
    expect(ctx.repos.ads.countRows()).toBe(0);
    const real = await ctx.services.ads.importFromFolder();
    const bad = real.files.find((f) => f.file === "bad.csv")!;
    expect(bad.status).toBe("failed");
    expect(bad.hint).toBeDefined();
    expect(existsSync(join(ctx.paths.inbox, "bad.csv"))).toBe(true);
  });

  it("detects gaps in coverage", () => {
    const ctx = createTestContext();
    const base = {
      ad_name: "A",
      adset_id: null,
      adset_name: "S",
      campaign_id: null,
      campaign_name: "C",
      objective: null,
      source: "export" as const,
      spend: 1,
      impressions: 1,
      reach: 1,
      clicks_all: 0,
      link_clicks: 0,
      landing_page_views: 0,
      add_to_cart: 0,
      initiate_checkout: 0,
      purchases: 0,
      purchase_value: 0,
      leads: 0,
      messages: 0,
      video_3s_views: 0,
      video_thruplays: 0,
    };
    ctx.repos.ads.upsertDaily([
      { ...base, date: "2026-10-01", ad_id: "a" },
      { ...base, date: "2026-10-04", ad_id: "a" },
    ]);
    expect(ctx.services.ads.coverage().gaps).toEqual([
      { since: "2026-10-02", until: "2026-10-03", days: 2 },
    ]);
  });
});
