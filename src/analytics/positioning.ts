import type { PositioningWeights } from "../config/business.js";

export const SIGNALS = [
  "active_ad_count",
  "ad_longevity",
  "creative_velocity",
  "offer_aggressiveness",
  "social_proof",
  "social_following",
  "web_traffic",
  "price_position",
] as const;
export type SignalName = (typeof SIGNALS)[number];

export const SIGNAL_INFO: Record<
  SignalName,
  { label: string; source: string; scale: "log" | "linear" | "inverse" }
> = {
  active_ad_count: {
    label: "Active ads",
    source: "Ad Library / manual competitor ad import",
    scale: "log",
  },
  ad_longevity: {
    label: "Avg days active ads have run",
    source: "Ad Library / manual import",
    scale: "linear",
  },
  creative_velocity: {
    label: "New ads per week (last 28 days)",
    source: "Ad Library / manual import",
    scale: "linear",
  },
  offer_aggressiveness: {
    label: "Offers on website (count + discount depth)",
    source: "Website snapshots",
    scale: "linear",
  },
  social_proof: {
    label: "Reviews / customer counts shown",
    source: "Website snapshots or manual signal",
    scale: "log",
  },
  social_following: {
    label: "Social followers",
    source: "Manual signal (social_followers)",
    scale: "log",
  },
  web_traffic: {
    label: "Monthly web visits (estimate)",
    source: "Manual signal (web_traffic)",
    scale: "log",
  },
  price_position: {
    label: "Price vs your price (lower = more aggressive)",
    source: "Website snapshots vs business.yaml product prices",
    scale: "inverse",
  },
};

export interface BrandSignals {
  name: string;
  is_self: boolean;
  /** null = unknown (not observed), which is different from 0. */
  raw: Partial<Record<SignalName, number | null>>;
  sources?: Partial<Record<SignalName, string>>;
}

export interface SignalScore {
  raw: number | null;
  score: number | null;
  weight: number;
  source?: string;
}

export interface BrandPosition {
  rank: number | null;
  name: string;
  is_self: boolean;
  presence_score: number | null;
  coverage_pct: number;
  confidence: "high" | "medium" | "low";
  signals: Record<SignalName, SignalScore>;
}

const transform = (scale: "log" | "linear" | "inverse", v: number) =>
  scale === "log" ? Math.log1p(Math.max(0, v)) : Math.max(0, v);

/**
 * Market Presence Score: each observable signal is scaled 0-100 relative to the best brand on that signal
 * (log scale for heavy-tailed counts; for price, the cheapest brand scores 100), then weighted-averaged over the
 * signals that brand has data for. Coverage = share of total weight with data. Never a sales estimate.
 */
export function computePositioning(
  brands: BrandSignals[],
  weights: PositioningWeights,
): BrandPosition[] {
  const active = SIGNALS.filter((s) => (weights[s] ?? 0) > 0);
  const totalWeight = active.reduce((sum, s) => sum + weights[s], 0);
  const scores = new Map<string, Record<SignalName, SignalScore>>();
  for (const b of brands) scores.set(b.name, {} as Record<SignalName, SignalScore>);

  for (const s of SIGNALS) {
    const { scale } = SIGNAL_INFO[s];
    const values = brands
      .map((b) => b.raw[s])
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    let ref: number | null = null;
    if (values.length) {
      ref =
        scale === "inverse"
          ? Math.min(...values.filter((v) => v > 0))
          : Math.max(...values.map((v) => transform(scale, v)));
    }
    for (const b of brands) {
      const raw = b.raw[s];
      let score: number | null = null;
      if (raw !== null && raw !== undefined && Number.isFinite(raw)) {
        if (scale === "inverse") score = raw > 0 && ref ? (ref / raw) * 100 : null;
        else score = ref && ref > 0 ? (transform(scale, raw) / ref) * 100 : 0;
      }
      scores.get(b.name)![s] = {
        raw: raw ?? null,
        score: score === null ? null : Math.round(score * 10) / 10,
        weight: weights[s] ?? 0,
        ...(b.sources?.[s] ? { source: b.sources[s] } : {}),
      };
    }
  }

  const out: BrandPosition[] = brands.map((b) => {
    const sig = scores.get(b.name)!;
    const withData = active.filter((s) => sig[s].score !== null);
    const w = withData.reduce((sum, s) => sum + weights[s], 0);
    const presence =
      w > 0 ? withData.reduce((sum, s) => sum + sig[s].score! * weights[s], 0) / w : null;
    const coverage = totalWeight > 0 ? w / totalWeight : 0;
    return {
      rank: null,
      name: b.name,
      is_self: b.is_self,
      presence_score: presence === null ? null : Math.round(presence * 10) / 10,
      coverage_pct: Math.round(coverage * 1000) / 10,
      confidence: coverage >= 0.7 ? "high" : coverage >= 0.4 ? "medium" : "low",
      signals: sig,
    };
  });
  out.sort((a, b) => (b.presence_score ?? -1) - (a.presence_score ?? -1));
  let rank = 0;
  for (const p of out) p.rank = p.presence_score === null ? null : ++rank;
  return out;
}
