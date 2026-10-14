import type { PrimaryKpi } from "../config/business.js";
import { COUNT_FIELDS, type RawCounts } from "../types/ads.js";
import type { DerivedMetrics, MetricName, MetricSet } from "../types/metrics.js";

export function emptyCounts(): RawCounts {
  const c = {} as RawCounts;
  for (const f of COUNT_FIELDS) c[f] = 0;
  return c;
}

/** Sums raw counts. Ratios must always be derived after summing, never averaged. */
export function sumCounts(rows: readonly Partial<RawCounts>[]): RawCounts {
  const out = emptyCounts();
  for (const r of rows) for (const f of COUNT_FIELDS) out[f] += r[f] ?? 0;
  return out;
}

/** a / b, or null when b is 0 or either side is not finite. Never Infinity/NaN. */
export function safeDiv(a: number, b: number): number | null {
  if (!b || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const v = a / b;
  return Number.isFinite(v) ? v : null;
}

export function conversionsFor(c: RawCounts, kpi: PrimaryKpi): number {
  return c[kpi];
}

export function deriveMetrics(c: RawCounts, kpi: PrimaryKpi): MetricSet {
  const conversions = conversionsFor(c, kpi);
  const derived: DerivedMetrics = {
    ctr: safeDiv(c.link_clicks, c.impressions),
    cpc: safeDiv(c.spend, c.link_clicks),
    cpm: c.impressions ? safeDiv(c.spend * 1000, c.impressions) : null,
    frequency: safeDiv(c.impressions, c.reach),
    conversions,
    cpa: safeDiv(c.spend, conversions),
    roas: safeDiv(c.purchase_value, c.spend),
    conversion_rate: safeDiv(conversions, c.link_clicks),
    lpv_rate: safeDiv(c.landing_page_views, c.link_clicks),
    hook_rate: safeDiv(c.video_3s_views, c.impressions),
    hold_rate: safeDiv(c.video_thruplays, c.video_3s_views),
    atc_rate: safeDiv(c.add_to_cart, c.landing_page_views),
    checkout_rate: safeDiv(c.initiate_checkout, c.add_to_cart),
    purchase_rate: safeDiv(c.purchases, c.initiate_checkout),
  };
  return { ...c, ...derived };
}

export const LOWER_IS_BETTER = new Set<MetricName>(["cpc", "cpm", "cpa"]);
/** Volume metrics (and frequency) have no inherent good/bad direction. */
export const NEUTRAL_METRICS = new Set<MetricName>([
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks_all",
]);

export interface MetricDefinition {
  name: MetricName;
  label: string;
  formula: string;
  unit: "money" | "ratio" | "count" | "multiple";
  better: "higher" | "lower" | "neutral";
  notes?: string;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { name: "spend", label: "Amount spent", formula: "sum(spend)", unit: "money", better: "neutral" },
  {
    name: "impressions",
    label: "Impressions",
    formula: "sum(impressions)",
    unit: "count",
    better: "neutral",
  },
  {
    name: "reach",
    label: "Reach",
    formula: "sum(daily reach)",
    unit: "count",
    better: "neutral",
    notes:
      "Summing daily reach over-counts people reached on several days, so multi-day reach is an upper bound.",
  },
  {
    name: "ctr",
    label: "CTR (link)",
    formula: "link_clicks / impressions",
    unit: "ratio",
    better: "higher",
  },
  {
    name: "cpc",
    label: "CPC (link)",
    formula: "spend / link_clicks",
    unit: "money",
    better: "lower",
  },
  {
    name: "cpm",
    label: "CPM",
    formula: "spend / impressions × 1000",
    unit: "money",
    better: "lower",
  },
  {
    name: "frequency",
    label: "Frequency",
    formula: "impressions / reach",
    unit: "multiple",
    better: "neutral",
    notes:
      "Computed from summed daily reach, so it approximates average daily frequency (a lower bound of true frequency).",
  },
  {
    name: "conversions",
    label: "Primary conversions",
    formula: "sum(<goals.primary_kpi>)",
    unit: "count",
    better: "higher",
  },
  {
    name: "cpa",
    label: "CPA",
    formula: "spend / primary conversions",
    unit: "money",
    better: "lower",
  },
  {
    name: "roas",
    label: "ROAS",
    formula: "purchase_value / spend",
    unit: "multiple",
    better: "higher",
  },
  {
    name: "conversion_rate",
    label: "Conversion rate",
    formula: "primary conversions / link_clicks",
    unit: "ratio",
    better: "higher",
  },
  {
    name: "lpv_rate",
    label: "Landing page view rate",
    formula: "landing_page_views / link_clicks",
    unit: "ratio",
    better: "higher",
    notes: "Low values usually mean a slow or broken landing page.",
  },
  {
    name: "hook_rate",
    label: "Hook rate (video)",
    formula: "video_3s_views / impressions",
    unit: "ratio",
    better: "higher",
  },
  {
    name: "hold_rate",
    label: "Hold rate (video)",
    formula: "video_thruplays / video_3s_views",
    unit: "ratio",
    better: "higher",
  },
  {
    name: "atc_rate",
    label: "Add-to-cart rate",
    formula: "add_to_cart / landing_page_views",
    unit: "ratio",
    better: "higher",
  },
  {
    name: "checkout_rate",
    label: "Checkout rate",
    formula: "initiate_checkout / add_to_cart",
    unit: "ratio",
    better: "higher",
  },
  {
    name: "purchase_rate",
    label: "Purchase rate",
    formula: "purchases / initiate_checkout",
    unit: "ratio",
    better: "higher",
  },
];

const MONEY = new Set<MetricName>(["spend", "purchase_value", "cpc", "cpm", "cpa"]);
const TWO_DP = new Set<MetricName>(["frequency", "roas"]);

/** Rounds for presentation: money 2dp, frequency/ROAS 2dp, ratios 4dp, counts as-is. */
export function roundMetric(name: MetricName, v: number | null): number | null {
  if (v === null) return null;
  if (MONEY.has(name) || TWO_DP.has(name)) return Math.round(v * 100) / 100;
  if (Number.isInteger(v)) return v;
  return Math.round(v * 10000) / 10000;
}

export function roundMetricSet(m: MetricSet): MetricSet {
  const out = { ...m } as Record<string, number | null>;
  for (const k of Object.keys(out)) out[k] = roundMetric(k as MetricName, out[k] ?? null);
  return out as unknown as MetricSet;
}

/** The KPIs most tools show per entity (keeps responses compact). */
export const COMPACT_METRICS: MetricName[] = [
  "spend",
  "impressions",
  "link_clicks",
  "conversions",
  "purchase_value",
  "ctr",
  "cpc",
  "cpm",
  "cpa",
  "roas",
  "frequency",
  "lpv_rate",
  "hook_rate",
];

export function compactMetrics(
  m: MetricSet,
  names: MetricName[] = COMPACT_METRICS,
): Partial<MetricSet> {
  const out: Record<string, number | null> = {};
  for (const n of names) out[n] = roundMetric(n, m[n] ?? null);
  return out as Partial<MetricSet>;
}

export const ALL_METRIC_NAMES: MetricName[] = [
  ...COUNT_FIELDS,
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "conversions",
  "cpa",
  "roas",
  "conversion_rate",
  "lpv_rate",
  "hook_rate",
  "hold_rate",
  "atc_rate",
  "checkout_rate",
  "purchase_rate",
];
