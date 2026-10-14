import { beforeAll, describe, expect, it } from "vitest";
import { callTool, type AnyToolDef } from "../../src/mcp/tooling.js";
import { allTools } from "../../src/mcp/tools/index.js";
import type { AppContext } from "../../src/context.js";
import { createTestContext, importSample } from "../helpers/context.js";

export async function call(ctx: AppContext, name: string, args: Record<string, unknown> = {}) {
  const tool = allTools.find((t: AnyToolDef) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const res = await callTool(tool, args, ctx);
  const text = (res.content[0] as { text: string }).text;
  return { isError: res.isError === true, data: JSON.parse(text) };
}

const verdictOf = (data: { groups: Record<string, { name: string }[]> }) => {
  const out: Record<string, string> = {};
  for (const [verdict, items] of Object.entries(data.groups))
    for (const i of items) out[i.name] = verdict;
  return out;
};

describe("performance tools on sample data (example targets)", () => {
  const ctx = createTestContext({ business: "example" });
  beforeAll(() => importSample(ctx));

  it("gives the seeded ads the right verdicts", async () => {
    const { data, isError } = await call(ctx, "get_winners_and_losers", {
      period: "last_30d",
      limit: 50,
    });
    expect(isError).toBe(false);
    expect(data.period).toEqual({ since: "2026-09-14", until: "2026-10-13" });
    const v = verdictOf(data);
    expect(v).toEqual({
      "UGC Review - Nadia": "winner",
      "Founder Story Video": "winner",
      "Free Delivery Offer": "winner",
      "Before-After Reel": "fatigued",
      "Static Discount Banner": "loser",
      "Limited Stock Countdown": "loser",
      "Ingredient Spotlight": "loser",
      "Carousel - 3 Benefits": "average",
      "Testimonial Static": "average",
      "Bundle Offer Carousel": "average",
      "How To Use Video": "average",
      "New Launch Teaser": "learning",
    });
    expect(data.basis.method).toBe("targets");
  });

  it("detects the fatiguing ad with evidence", async () => {
    const { data } = await call(ctx, "detect_creative_fatigue", {});
    expect(data.fatigued.map((f: { ad_name: string }) => f.ad_name)).toEqual(["Before-After Reel"]);
    expect(data.recent_window).toEqual({ since: "2026-10-07", until: "2026-10-13" });
    const codes = data.fatigued[0].evidence.map((e: { code: string }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["FREQUENCY_HIGH", "CTR_DROP", "CPA_RISE"]));
  });

  it("summarises the account with a previous-period comparison", async () => {
    const { data } = await call(ctx, "get_performance_summary", { period: "last_7d" });
    expect(data.summary).toMatch(/BDT/);
    expect(data.totals.spend).toBeGreaterThan(0);
    expect(data.comparison.cpa.direction).toMatch(/better|worse|flat/);
    expect(data.vs_targets.cpa.target).toBe(400);
    expect(data.active.ads).toBe(12);
  });

  it("finds the seeded funnel problems on the right ads", async () => {
    const { data } = await call(ctx, "get_funnel_diagnostics", { period: "last_30d" });
    const flagsFor = (name: string) =>
      data.entities_with_flags
        .find((e: { name: string }) => e.name === name)
        ?.flags.map((f: { code: string }) => f.code) ?? [];
    expect(flagsFor("Static Discount Banner")).toContain("LANDING_PAGE_DROP_OFF");
    expect(flagsFor("Limited Stock Countdown")).toContain("LOW_HOOK_RATE");
    expect(flagsFor("Ingredient Spotlight")).toContain("OFFER_OR_PAGE_PROBLEM");
    expect(flagsFor("Bundle Offer Carousel")).toContain("CHECKOUT_OR_TRUST_PROBLEM");
    expect(flagsFor("UGC Review - Nadia")).toEqual([]);
  });

  it("returns top creatives with their copy", async () => {
    const { data } = await call(ctx, "get_top_creatives", { period: "last_30d", limit: 3 });
    expect(data.ads.map((a: { name: string }) => a.name)).toEqual([
      "Free Delivery Offer",
      "Before-After Reel",
      "UGC Review - Nadia",
    ]);
    expect(data.ads[0].creative.headline).toBe("Still thinking? Delivery is on us");
    expect(data.ads[0].creative.format).toBe("image");
  });

  it("breaks down by campaign and sorts cost metrics ascending", async () => {
    const { data } = await call(ctx, "get_breakdown", {
      period: "last_30d",
      level: "campaign",
      sort_by: "cpa",
    });
    expect(data.rows).toHaveLength(3);
    expect(data.rows[0].name).toBe("Retargeting | Sales");
    expect(data.rows[0].metrics.cpa).toBeLessThan(data.rows[1].metrics.cpa);
  });

  it("returns a daily trend for one ad", async () => {
    const { data: bd } = await call(ctx, "get_breakdown", { period: "last_30d", level: "ad" });
    const id = bd.rows.find((r: { name: string }) => r.name === "Before-After Reel").id;
    const { data } = await call(ctx, "get_daily_trend", {
      period: "last_14d",
      metrics: ["ctr", "frequency"],
      level: "ad",
      entity_id: id,
    });
    expect(data.series).toHaveLength(14);
    expect(data.series[13].frequency).toBeGreaterThan(3);
    expect(data.series[0].frequency).toBeLessThan(2);
  });

  it("lists budget reallocation candidates", async () => {
    const { data } = await call(ctx, "get_budget_recommendations_data", { period: "last_30d" });
    expect(data.campaigns.rows).toHaveLength(3);
    const under = data.adsets.under_funded_winners.map((r: { name: string }) => r.name).join();
    expect(under).toContain("Website visitors 30d");
    expect(data.adsets.over_funded_losers.map((r: { name: string }) => r.name).join()).toContain(
      "Broad 18-45",
    );
    expect(data.pacing.monthly_budget).toBe(150000);
  });
});

describe("error handling", () => {
  it("returns NoDataError as a friendly isError result", async () => {
    const ctx = createTestContext();
    const r = await call(ctx, "get_performance_summary", { period: "last_7d" });
    expect(r.isError).toBe(true);
    expect(r.data.type).toBe("NoDataError");
    expect(r.data.hint).toContain("data/inbox");
  });
  it("validates input", async () => {
    const ctx = createTestContext();
    const r = await call(ctx, "get_breakdown", { period: "last_99d", level: "ad" });
    expect(r.isError).toBe(true);
    expect(r.data.type).toBe("ValidationError");
  });
  it("anchors relative periods to the last data day when data is stale", async () => {
    const ctx = createTestContext({ business: "example", now: new Date("2026-10-20T09:00:00") });
    await importSample(ctx);
    const { data } = await call(ctx, "get_performance_summary", { period: "yesterday" });
    expect(data.period).toEqual({ since: "2026-10-13", until: "2026-10-13" });
    expect(data.warnings.join(" ")).toMatch(/stale/);
  });
});
