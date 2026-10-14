import type { Comparison, MetricDelta, MetricName, MetricSet } from "../types/metrics.js";
import { LOWER_IS_BETTER, NEUTRAL_METRICS, roundMetric } from "./metrics.js";

/** Changes smaller than this (relative) are "flat". */
export const FLAT_THRESHOLD = 0.02;

export function deltaFor(
  name: MetricName,
  current: number | null,
  previous: number | null,
): MetricDelta {
  const cur = roundMetric(name, current);
  const prev = roundMetric(name, previous);
  if (current === null || previous === null) {
    return { current: cur, previous: prev, delta_pct: null, change: null, direction: null };
  }
  if (previous === 0) {
    const change = current === 0 ? "flat" : current > 0 ? "up" : "down";
    return {
      current: cur,
      previous: prev,
      delta_pct: null,
      change,
      direction: NEUTRAL_METRICS.has(name) ? null : directionOf(name, change),
    };
  }
  const rel = (current - previous) / Math.abs(previous);
  const change = Math.abs(rel) < FLAT_THRESHOLD ? "flat" : rel > 0 ? "up" : "down";
  return {
    current: cur,
    previous: prev,
    delta_pct: Math.round(rel * 10000) / 100,
    change,
    direction: NEUTRAL_METRICS.has(name) ? null : directionOf(name, change),
  };
}

function directionOf(
  name: MetricName,
  change: "up" | "down" | "flat",
): "better" | "worse" | "flat" {
  if (change === "flat") return "flat";
  const up = change === "up";
  return LOWER_IS_BETTER.has(name) ? (up ? "worse" : "better") : up ? "better" : "worse";
}

/** Period-over-period deltas. delta_pct is a percentage (12.5 = +12.5%). */
export function compareMetrics(
  current: MetricSet,
  previous: MetricSet,
  names: MetricName[],
): Comparison {
  const out: Comparison = {};
  for (const n of names) out[n] = deltaFor(n, current[n] ?? null, previous[n] ?? null);
  return out;
}
