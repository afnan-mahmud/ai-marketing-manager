import type { PrimaryKpi } from "../config/business.js";
import type { MetricSet, Reason, Verdict } from "../types/metrics.js";

export interface ClassifySettings {
  primary_kpi: PrimaryKpi;
  targets: { max_cpa?: number; min_roas?: number; min_ctr_pct?: number };
  min_spend_for_verdict: number;
  min_impressions_for_verdict: number;
  fatigue_frequency: number;
}

export interface Classified {
  verdict: Verdict;
  reasons: Reason[];
}

/** A loser has CPA above this multiple of max_cpa. */
export const LOSER_CPA_MULTIPLE = 1.5;
/** Quartile ranking needs at least this many ads with enough data. */
export const MIN_PEERS_FOR_QUARTILES = 4;

const round = (v: number | null, dp = 2) =>
  v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp;

export function isLearning(m: MetricSet, s: ClassifySettings): Reason[] | null {
  const reasons: Reason[] = [];
  if (m.spend < s.min_spend_for_verdict) {
    reasons.push({
      code: "SPEND_BELOW_MIN",
      value: round(m.spend),
      target: s.min_spend_for_verdict,
    });
  }
  if (m.impressions < s.min_impressions_for_verdict) {
    reasons.push({
      code: "IMPRESSIONS_BELOW_MIN",
      value: m.impressions,
      target: s.min_impressions_for_verdict,
    });
  }
  return reasons.length ? reasons : null;
}

/** ROAS targets only apply when the account tracks purchase value at all. */
function roasApplies(s: ClassifySettings, roasTracked: boolean): boolean {
  return s.targets.min_roas !== undefined && roasTracked;
}

function hasTargets(s: ClassifySettings, roasTracked: boolean): boolean {
  return s.targets.max_cpa !== undefined || roasApplies(s, roasTracked);
}

function classifyAgainstTargets(
  m: MetricSet,
  s: ClassifySettings,
  roasTracked: boolean,
): Classified {
  const reasons: Reason[] = [];
  const maxCpa = s.targets.max_cpa;
  const minRoas = s.targets.min_roas;
  let meetsAll = true;
  let isLoser = false;

  if (maxCpa !== undefined) {
    if (m.cpa === null) {
      // No conversions at all: a loser once spend exceeds what a "bad" conversion would have cost.
      meetsAll = false;
      if (m.spend >= LOSER_CPA_MULTIPLE * maxCpa) {
        isLoser = true;
        reasons.push({ code: "NO_CONVERSIONS", value: 0, spend: round(m.spend), target: maxCpa });
      } else {
        reasons.push({
          code: "NO_CONVERSIONS_YET",
          value: 0,
          spend: round(m.spend),
          target: maxCpa,
        });
      }
    } else if (m.cpa <= maxCpa) {
      reasons.push({ code: "CPA_WITHIN_TARGET", value: round(m.cpa), target: maxCpa });
    } else {
      meetsAll = false;
      if (m.cpa > LOSER_CPA_MULTIPLE * maxCpa) {
        isLoser = true;
        reasons.push({
          code: "CPA_FAR_ABOVE_TARGET",
          value: round(m.cpa),
          target: maxCpa,
          limit: LOSER_CPA_MULTIPLE * maxCpa,
        });
      } else {
        reasons.push({ code: "CPA_ABOVE_TARGET", value: round(m.cpa), target: maxCpa });
      }
    }
  }
  if (minRoas !== undefined && roasApplies(s, roasTracked)) {
    const roas = m.roas ?? 0;
    if (roas >= minRoas)
      reasons.push({ code: "ROAS_MEETS_TARGET", value: round(roas), target: minRoas });
    else {
      meetsAll = false;
      reasons.push({ code: "ROAS_BELOW_TARGET", value: round(roas), target: minRoas });
      // Without a CPA target, very poor ROAS is what makes a loser.
      if (maxCpa === undefined && roas < minRoas / LOSER_CPA_MULTIPLE) isLoser = true;
    }
  }
  if (isLoser) return { verdict: "loser", reasons };
  if (meetsAll) return { verdict: "winner", reasons };
  return { verdict: "average", reasons };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Assigns winner / loser / learning / average to each entity (fatigue is layered on by the caller).
 * With targets (goals.targets) entities are judged against them; without, against account quartiles of CPA.
 */
export function classifyEntities(
  entities: readonly { id: string; metrics: MetricSet }[],
  s: ClassifySettings,
  opts: { roasTracked?: boolean } = {},
): Map<string, Classified> {
  const roasTracked = opts.roasTracked ?? entities.some((e) => e.metrics.purchase_value > 0);
  const out = new Map<string, Classified>();
  const eligible: { id: string; metrics: MetricSet }[] = [];

  for (const e of entities) {
    const learning = isLearning(e.metrics, s);
    if (learning) out.set(e.id, { verdict: "learning", reasons: learning });
    else eligible.push(e);
  }

  if (hasTargets(s, roasTracked)) {
    for (const e of eligible) out.set(e.id, classifyAgainstTargets(e.metrics, s, roasTracked));
    return out;
  }

  if (eligible.length < MIN_PEERS_FOR_QUARTILES) {
    for (const e of eligible) {
      out.set(e.id, {
        verdict: "average",
        reasons: [
          {
            code: "NO_TARGETS_TOO_FEW_ADS",
            value: eligible.length,
            target: MIN_PEERS_FOR_QUARTILES,
          },
        ],
      });
    }
    return out;
  }

  // Zero-conversion entities rank as the most expensive.
  const costs = eligible
    .map((e) => e.metrics.cpa ?? Number.POSITIVE_INFINITY)
    .sort((a, b) => a - b);
  const finite = costs.filter(Number.isFinite);
  const q1 = quantile(
    costs.map((c) => (Number.isFinite(c) ? c : Number.MAX_VALUE)),
    0.25,
  );
  const q3 = quantile(
    costs.map((c) => (Number.isFinite(c) ? c : Number.MAX_VALUE)),
    0.75,
  );
  const median = finite.length ? quantile(finite, 0.5) : null;
  for (const e of eligible) {
    const cpa = e.metrics.cpa;
    const ctx = {
      q1: q1 === Number.MAX_VALUE ? null : round(q1),
      q3: q3 === Number.MAX_VALUE ? null : round(q3),
      median: round(median),
    };
    if (cpa !== null && cpa <= q1)
      out.set(e.id, {
        verdict: "winner",
        reasons: [{ code: "CPA_TOP_QUARTILE", value: round(cpa), ...ctx }],
      });
    else if (cpa === null)
      out.set(e.id, {
        verdict: "loser",
        reasons: [{ code: "NO_CONVERSIONS", value: 0, spend: round(e.metrics.spend) }],
      });
    else if (cpa >= q3)
      out.set(e.id, {
        verdict: "loser",
        reasons: [{ code: "CPA_BOTTOM_QUARTILE", value: round(cpa), ...ctx }],
      });
    else
      out.set(e.id, {
        verdict: "average",
        reasons: [{ code: "CPA_MID_RANGE", value: round(cpa), ...ctx }],
      });
  }
  return out;
}
