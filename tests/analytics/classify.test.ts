import { describe, expect, it } from "vitest";
import { budgetEfficiency } from "../../src/analytics/budget.js";
import { classifyEntities, type ClassifySettings } from "../../src/analytics/classify.js";
import { diagnose, funnelSteps } from "../../src/analytics/diagnostics.js";
import { evaluateFatigue } from "../../src/analytics/fatigue.js";
import { deriveMetrics, emptyCounts } from "../../src/analytics/metrics.js";
import type { RawCounts } from "../../src/types/ads.js";

const m = (c: Partial<RawCounts>) => deriveMetrics({ ...emptyCounts(), ...c }, "purchases");
const base: ClassifySettings = {
  primary_kpi: "purchases",
  targets: { max_cpa: 400, min_roas: 2.5 },
  min_spend_for_verdict: 1000,
  min_impressions_for_verdict: 3000,
  fatigue_frequency: 3,
};

describe("classifyEntities with targets", () => {
  const ents = [
    {
      id: "win",
      metrics: m({ spend: 3000, impressions: 20000, purchases: 10, purchase_value: 12000 }),
    },
    {
      id: "avg",
      metrics: m({ spend: 4500, impressions: 20000, purchases: 10, purchase_value: 12000 }),
    },
    {
      id: "lose",
      metrics: m({ spend: 7000, impressions: 20000, purchases: 10, purchase_value: 12000 }),
    },
    { id: "zero", metrics: m({ spend: 2000, impressions: 20000 }) },
    { id: "young", metrics: m({ spend: 900, impressions: 20000, purchases: 1 }) },
    {
      id: "lowroas",
      metrics: m({ spend: 3000, impressions: 20000, purchases: 10, purchase_value: 6000 }),
    },
  ];
  const v = classifyEntities(ents, base);
  it("assigns verdicts and reason codes", () => {
    expect(v.get("win")!.verdict).toBe("winner");
    expect(v.get("win")!.reasons[0]).toEqual({
      code: "CPA_WITHIN_TARGET",
      value: 300,
      target: 400,
    });
    expect(v.get("avg")!.verdict).toBe("average");
    expect(v.get("lose")!.verdict).toBe("loser");
    expect(v.get("lose")!.reasons[0]).toMatchObject({ code: "CPA_FAR_ABOVE_TARGET", value: 700 });
    expect(v.get("zero")!.verdict).toBe("loser");
    expect(v.get("young")!.verdict).toBe("learning");
    expect(v.get("young")!.reasons[0]!.code).toBe("SPEND_BELOW_MIN");
    expect(v.get("lowroas")!.verdict).toBe("average");
    expect(v.get("lowroas")!.reasons.map((r) => r.code)).toContain("ROAS_BELOW_TARGET");
  });

  it("ignores ROAS targets when no purchase value is tracked", () => {
    const r = classifyEntities(
      [{ id: "x", metrics: m({ spend: 3000, impressions: 9000, purchases: 10 }) }],
      base,
    );
    expect(r.get("x")!.verdict).toBe("winner");
  });
});

describe("classifyEntities without targets", () => {
  const s = { ...base, targets: {} };
  it("uses account quartiles", () => {
    const ents = [100, 200, 300, 400, 500, 600, 700, 800].map((cpa, i) => ({
      id: `a${i}`,
      metrics: m({ spend: cpa * 10, impressions: 10000, purchases: 10 }),
    }));
    const v = classifyEntities(ents, s);
    expect(v.get("a0")!.verdict).toBe("winner");
    expect(v.get("a1")!.verdict).toBe("winner");
    expect(v.get("a4")!.verdict).toBe("average");
    expect(v.get("a7")!.verdict).toBe("loser");
  });
  it("needs enough peers", () => {
    const v = classifyEntities(
      [{ id: "a", metrics: m({ spend: 5000, impressions: 10000, purchases: 2 }) }],
      s,
    );
    expect(v.get("a")!.verdict).toBe("average");
    expect(v.get("a")!.reasons[0]!.code).toBe("NO_TARGETS_TOO_FEW_ADS");
  });
});

describe("evaluateFatigue", () => {
  const opts = { frequencyThreshold: 3, minImpressions: 1000 };
  const baseline = m({
    spend: 3000,
    impressions: 30000,
    reach: 25000,
    link_clicks: 600,
    purchases: 12,
  });
  it("flags a former winner with high frequency and falling CTR", () => {
    const recent = m({
      spend: 1500,
      impressions: 15000,
      reach: 4000,
      link_clicks: 150,
      purchases: 2,
    });
    const r = evaluateFatigue({ recent, baseline, baselineVerdict: "winner" }, opts);
    expect(r.fatigued).toBe(true);
    expect(r.reasons.map((x) => x.code)).toEqual(
      expect.arrayContaining(["FREQUENCY_HIGH", "CTR_DROP", "CPA_RISE", "WAS_WINNER"]),
    );
  });
  it("does not flag when frequency is fine, or when the ad never won", () => {
    const lowFreq = m({
      spend: 1500,
      impressions: 15000,
      reach: 12000,
      link_clicks: 150,
      purchases: 2,
    });
    expect(
      evaluateFatigue({ recent: lowFreq, baseline, baselineVerdict: "winner" }, opts).fatigued,
    ).toBe(false);
    const highFreq = m({
      spend: 1500,
      impressions: 15000,
      reach: 4000,
      link_clicks: 150,
      purchases: 2,
    });
    const notWinner = evaluateFatigue(
      { recent: highFreq, baseline, baselineVerdict: "average" },
      opts,
    );
    expect(notWinner.fatigued).toBe(false);
    expect(notWinner.watch).toBe(true);
  });
  it("requires enough impressions", () => {
    const r = evaluateFatigue(
      { recent: m({ impressions: 10 }), baseline, baselineVerdict: "winner" },
      opts,
    );
    expect(r.reasons[0]!.code).toBe("NOT_ENOUGH_DATA");
  });
});

describe("budgetEfficiency", () => {
  it("computes shares and reallocation candidates", () => {
    const r = budgetEfficiency([
      { id: "a", name: "A", spend: 6000, conversions: 10, verdict: "loser" },
      { id: "b", name: "B", spend: 3000, conversions: 25, verdict: "winner" },
      { id: "c", name: "C", spend: 1000, conversions: 5, verdict: "average" },
    ]);
    expect(r.total_spend).toBe(10000);
    expect(r.rows.find((x) => x.id === "a")).toMatchObject({
      spend_share: 0.6,
      conversion_share: 0.25,
    });
    expect(r.over_funded_losers.map((x) => x.id)).toEqual(["a"]);
    expect(r.under_funded_winners.map((x) => x.id)).toEqual(["b"]);
  });
  it("handles zero conversions without dividing by zero", () => {
    const r = budgetEfficiency([{ id: "a", name: "A", spend: 100, conversions: 0 }]);
    expect(r.rows[0]!.conversion_share).toBeNull();
    expect(r.rows[0]!.efficiency_index).toBeNull();
  });
});

describe("diagnose", () => {
  const codes = (x: Partial<RawCounts>, prev?: Partial<RawCounts>) =>
    diagnose(m(x), { previous: prev ? m(prev) : undefined }).map((f) => f.code);
  it("flags low hook rate and low CTR", () => {
    expect(
      codes({ impressions: 10000, video_3s_views: 1500, video_thruplays: 400, link_clicks: 50 }),
    ).toEqual(expect.arrayContaining(["LOW_HOOK_RATE", "LOW_CTR"]));
  });
  it("flags landing page drop-off", () => {
    expect(codes({ impressions: 10000, link_clicks: 200, landing_page_views: 80 })).toContain(
      "LANDING_PAGE_DROP_OFF",
    );
  });
  it("flags offer/page problems when visitors arrive but don't add to cart", () => {
    expect(
      codes({ impressions: 10000, link_clicks: 300, landing_page_views: 250, add_to_cart: 3 }),
    ).toContain("OFFER_OR_PAGE_PROBLEM");
  });
  it("flags checkout/trust problems on cart abandonment", () => {
    expect(
      codes({
        impressions: 10000,
        link_clicks: 300,
        landing_page_views: 250,
        add_to_cart: 50,
        initiate_checkout: 20,
        purchases: 3,
      }),
    ).toContain("CHECKOUT_OR_TRUST_PROBLEM");
  });
  it("flags audience saturation when CPM rises with stable CTR", () => {
    expect(
      codes(
        { spend: 1300, impressions: 10000, link_clicks: 150 },
        { spend: 1000, impressions: 10000, link_clicks: 150 },
      ),
    ).toContain("AUDIENCE_SATURATION");
  });
  it("returns no flags for a healthy funnel and handles empty data", () => {
    expect(
      codes({
        impressions: 10000,
        link_clicks: 200,
        landing_page_views: 170,
        add_to_cart: 20,
        initiate_checkout: 10,
        purchases: 6,
      }),
    ).toEqual([]);
    expect(codes({})).toEqual([]);
    expect(funnelSteps(m({}))[0]!.rate).toBeNull();
  });
});
