import { describe, expect, it } from "vitest";
import { aggregateBy, aggregateByDay } from "../../src/analytics/aggregate.js";
import { compareMetrics, deltaFor } from "../../src/analytics/compare.js";
import { deriveMetrics, emptyCounts, safeDiv, sumCounts } from "../../src/analytics/metrics.js";
import type { AdDailyRow } from "../../src/types/ads.js";
import { previousPeriod, rangeLength, resolvePeriod } from "../../src/utils/dates.js";

export function row(p: Partial<AdDailyRow>): AdDailyRow {
  return {
    date: "2026-10-01",
    ad_id: "a1",
    ad_name: "Ad 1",
    adset_id: null,
    adset_name: "Set 1",
    campaign_id: null,
    campaign_name: "Camp 1",
    objective: null,
    source: "export",
    ...emptyCounts(),
    ...p,
  };
}

describe("safeDiv / deriveMetrics", () => {
  it("never returns Infinity or NaN", () => {
    expect(safeDiv(5, 0)).toBeNull();
    expect(safeDiv(0, 0)).toBeNull();
    expect(safeDiv(Number.NaN, 2)).toBeNull();
    const m = deriveMetrics(emptyCounts(), "purchases");
    for (const k of [
      "ctr",
      "cpc",
      "cpm",
      "frequency",
      "cpa",
      "roas",
      "lpv_rate",
      "hook_rate",
      "hold_rate",
    ] as const) {
      expect(m[k]).toBeNull();
    }
    expect(m.conversions).toBe(0);
  });

  it("derives ratios from summed counts, not averaged ratios", () => {
    // Day 1: CTR 10% on 100 impr; day 2: CTR 1% on 10,000 impr. Averaging would give 5.5%.
    const counts = sumCounts([
      { impressions: 100, link_clicks: 10, spend: 10 },
      { impressions: 10000, link_clicks: 100, spend: 90 },
    ]);
    const m = deriveMetrics(counts, "purchases");
    expect(m.ctr).toBeCloseTo(110 / 10100);
    expect(m.cpc).toBeCloseTo(100 / 110);
    expect(m.cpm).toBeCloseTo((100 / 10100) * 1000);
  });

  it("uses the primary KPI for conversions and CPA", () => {
    const c = {
      ...emptyCounts(),
      spend: 100,
      leads: 4,
      purchases: 1,
      messages: 10,
      link_clicks: 50,
    };
    expect(deriveMetrics(c, "leads").cpa).toBe(25);
    expect(deriveMetrics(c, "messages").cpa).toBe(10);
    expect(deriveMetrics(c, "link_clicks").cpa).toBe(2);
    expect(deriveMetrics(c, "purchases").cpa).toBe(100);
  });
});

describe("compare", () => {
  it("knows CPA/CPC/CPM are lower-is-better", () => {
    expect(deltaFor("cpa", 80, 100)).toMatchObject({
      delta_pct: -20,
      change: "down",
      direction: "better",
    });
    expect(deltaFor("cpm", 120, 100)).toMatchObject({ change: "up", direction: "worse" });
    expect(deltaFor("ctr", 0.02, 0.01)).toMatchObject({ delta_pct: 100, direction: "better" });
  });
  it("treats volume metrics as neutral and small changes as flat", () => {
    expect(deltaFor("spend", 200, 100).direction).toBeNull();
    expect(deltaFor("roas", 3.01, 3).direction).toBe("flat");
  });
  it("handles zero and null previous values", () => {
    expect(deltaFor("purchases", 5, 0)).toMatchObject({
      delta_pct: null,
      change: "up",
      direction: "better",
    });
    expect(deltaFor("cpa", 50, null)).toMatchObject({ delta_pct: null, direction: null });
    const cmp = compareMetrics(
      deriveMetrics(emptyCounts(), "purchases"),
      deriveMetrics(emptyCounts(), "purchases"),
      ["cpa", "spend"],
    );
    expect(cmp.cpa?.direction).toBeNull();
    expect(cmp.spend?.change).toBe("flat");
  });
});

describe("aggregate", () => {
  it("groups by level and fills missing days with zero", () => {
    const rows = [
      row({ ad_id: "a1", spend: 10, impressions: 100 }),
      row({ ad_id: "a2", ad_name: "Ad 2", spend: 5, impressions: 50 }),
      row({ ad_id: "a1", date: "2026-10-03", spend: 20, impressions: 200 }),
    ];
    const ads = aggregateBy(rows, "ad");
    expect(ads).toHaveLength(2);
    expect(ads.find((a) => a.id === "a1")).toMatchObject({
      first_date: "2026-10-01",
      last_date: "2026-10-03",
      days_with_spend: 2,
    });
    expect(ads.find((a) => a.id === "a1")!.counts.spend).toBe(30);
    const camps = aggregateBy(rows, "campaign");
    expect(camps).toHaveLength(1);
    expect(camps[0]!.counts.impressions).toBe(350);
    const days = aggregateByDay(rows, ["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days.map((d) => d.counts.spend)).toEqual([15, 0, 20]);
  });
  it("separates same-named ad sets in different campaigns", () => {
    const rows = [row({ campaign_name: "A" }), row({ campaign_name: "B", ad_id: "a2" })];
    expect(aggregateBy(rows, "adset")).toHaveLength(2);
  });
});

describe("periods", () => {
  it("resolves presets relative to today", () => {
    expect(resolvePeriod("yesterday", "2026-10-14")).toEqual({
      since: "2026-10-13",
      until: "2026-10-13",
    });
    expect(resolvePeriod("last_7d", "2026-10-14")).toEqual({
      since: "2026-10-07",
      until: "2026-10-13",
    });
    expect(resolvePeriod("this_month", "2026-10-14")).toEqual({
      since: "2026-10-01",
      until: "2026-10-13",
    });
    expect(rangeLength(resolvePeriod("last_30d", "2026-10-14"))).toBe(30);
    expect(previousPeriod({ since: "2026-10-07", until: "2026-10-13" })).toEqual({
      since: "2026-09-30",
      until: "2026-10-06",
    });
    expect(() =>
      resolvePeriod({ since: "2026-10-05", until: "2026-10-01" }, "2026-10-14"),
    ).toThrow();
  });
});
