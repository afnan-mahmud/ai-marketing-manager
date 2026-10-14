import { z } from "zod";
import { ALL_METRIC_NAMES } from "../../analytics/metrics.js";
import type { MetricName } from "../../types/metrics.js";
import { periodSchema } from "../../utils/dates.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

const period = periodSchema.describe(
  'Period: "yesterday" | "last_7d" | "last_14d" | "last_30d" | "this_month" | {since, until} (YYYY-MM-DD).',
);
const level = z.enum(["campaign", "adset", "ad"]);
const metricName = z.enum(ALL_METRIC_NAMES as [MetricName, ...MetricName[]]);

export const getPerformanceSummary = defineTool({
  name: "get_performance_summary",
  title: "Performance summary",
  description:
    "Account totals for a period: spend, conversions (per goals.primary_kpi), CTR, CPC, CPM, CPA, ROAS, funnel rates, comparison vs the previous equal-length period (better/worse aware of lower-is-better metrics) and status vs targets.",
  inputSchema: {
    period,
    compare: z
      .boolean()
      .optional()
      .describe("Compare with the previous equal-length period (default true)."),
  },
  handler: (args, ctx) =>
    ctx.services.analytics.performanceSummary(args.period, args.compare ?? true),
});

export const getBreakdown = defineTool({
  name: "get_breakdown",
  title: "Breakdown by campaign / ad set / ad",
  description:
    "Table of KPIs per campaign, ad set or ad with a verdict (winner/loser/fatigued/learning/average) and machine-readable reasons. Cost metrics (cpa/cpc/cpm) sort lowest first; others highest first.",
  inputSchema: {
    period,
    level,
    sort_by: metricName.optional().describe("Metric to sort by (default spend)."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 25)."),
  },
  handler: (args, ctx) =>
    ctx.services.analytics.breakdown(
      args.period,
      args.level,
      args.sort_by ?? "spend",
      args.limit ?? 25,
    ),
});

export const getDailyTrend = defineTool({
  name: "get_daily_trend",
  title: "Daily trend",
  description:
    "Daily time series of chosen metrics for the account or one entity (pass level + entity_id from get_breakdown). Ratios are computed per day from that day's counts.",
  inputSchema: {
    period,
    metrics: z.array(metricName).min(1).max(10).describe('e.g. ["spend", "cpa", "ctr"]'),
    level: level.optional(),
    entity_id: z.string().optional(),
  },
  handler: (args, ctx) =>
    ctx.services.analytics.dailyTrend(args.period, args.metrics, args.level, args.entity_id),
});

export const getWinnersAndLosers = defineTool({
  name: "get_winners_and_losers",
  title: "Winners and losers",
  description:
    "Every ad grouped by verdict — winner, fatigued, loser, average, learning — with reason codes and numbers (e.g. {code: CPA_ABOVE_TARGET, value: 520, target: 400}). Uses goals.targets, or account quartiles when no targets are set.",
  inputSchema: {
    period,
    limit: z.number().int().min(1).max(100).optional().describe("Max ads per group (default 10)."),
  },
  handler: (args, ctx) => ctx.services.analytics.winnersAndLosers(args.period, args.limit ?? 10),
});

export const detectCreativeFatigue = defineTool({
  name: "detect_creative_fatigue",
  title: "Creative fatigue",
  description:
    "Finds former winners that are wearing out: recent frequency ≥ threshold AND (CTR down ≥20% OR CPA up ≥25%) vs the ad's own previous 14 days. Also returns a watchlist of ads showing early signs.",
  inputSchema: {
    lookback_days: z
      .number()
      .int()
      .min(3)
      .max(14)
      .optional()
      .describe("Recent window length in days (default 7)."),
  },
  handler: (args, ctx) => ctx.services.analytics.creativeFatigue(args.lookback_days ?? 7),
});

export const getFunnelDiagnostics = defineTool({
  name: "get_funnel_diagnostics",
  title: "Funnel diagnostics",
  description:
    "Step conversion rates (impression → click → landing page view → add to cart → checkout → purchase) plus rule-based problem flags (low hook rate, landing page drop-off, offer problem, checkout/trust problem, audience saturation), for the account and per entity.",
  inputSchema: {
    period,
    level: level.optional().describe("Level for per-entity flags, or of entity_id (default ad)."),
    entity_id: z.string().optional(),
  },
  handler: (args, ctx) =>
    ctx.services.analytics.funnelDiagnostics(args.period, args.level, args.entity_id),
});

export const getBudgetRecommendationsData = defineTool({
  name: "get_budget_recommendations_data",
  title: "Budget efficiency data",
  description:
    "Share of spend vs share of conversions per campaign and ad set, efficiency index, budget pacing vs goals.monthly_budget, and reallocation candidates (over-funded losers, under-funded winners). Data for suggestions only — nothing is changed in Meta.",
  inputSchema: { period },
  handler: (args, ctx) => ctx.services.analytics.budgetData(args.period),
});

export const getTopCreatives = defineTool({
  name: "get_top_creatives",
  title: "Top creatives with copy",
  description:
    "Best ads ranked by cpa (lowest), roas, ctr or hook_rate (highest), including headline, primary text, CTA and format — the raw material for content plans and scripts. Learning ads are excluded.",
  inputSchema: {
    period,
    limit: z.number().int().min(1).max(25).optional().describe("Default 5."),
    by: z
      .enum(["cpa", "roas", "ctr", "hook_rate"])
      .optional()
      .describe("Ranking metric (default cpa)."),
  },
  handler: (args, ctx) =>
    ctx.services.analytics.topCreatives(args.period, args.limit ?? 5, args.by ?? "cpa"),
});

export const performanceTools: AnyToolDef[] = [
  getPerformanceSummary,
  getBreakdown,
  getDailyTrend,
  getWinnersAndLosers,
  detectCreativeFatigue,
  getFunnelDiagnostics,
  getBudgetRecommendationsData,
  getTopCreatives,
];
