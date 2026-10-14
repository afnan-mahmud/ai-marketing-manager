import type { RawCounts } from "./ads.js";

/** Derived KPIs. null = not computable (divide by zero / no data). */
export interface DerivedMetrics {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  conversions: number;
  cpa: number | null;
  roas: number | null;
  conversion_rate: number | null;
  lpv_rate: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  atc_rate: number | null;
  checkout_rate: number | null;
  purchase_rate: number | null;
}

export type MetricSet = RawCounts & DerivedMetrics;
export type MetricName = keyof MetricSet;

export type Verdict = "winner" | "loser" | "learning" | "fatigued" | "average";

export interface Reason {
  code: string;
  value?: number | null;
  target?: number | null;
  [k: string]: unknown;
}

export interface MetricDelta {
  current: number | null;
  previous: number | null;
  delta_pct: number | null;
  change: "up" | "down" | "flat" | null;
  /** better/worse knows which metrics are lower-is-better; null for neutral volume metrics. */
  direction: "better" | "worse" | "flat" | null;
}

export type Comparison = Partial<Record<MetricName, MetricDelta>>;
