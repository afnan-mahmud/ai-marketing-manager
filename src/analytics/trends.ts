import type { MarketSnapshot } from "../types/market.js";

const STOPWORDS = new Set(
  "a an the of in on for to and or with by is are was were be at from as this that these those it its into over more less vs via about".split(
    " ",
  ),
);

export function trendTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface RecurringTrend {
  trend: string;
  variants: string[];
  days_seen: number;
  dates: string[];
  first_seen: string;
  last_seen: string;
  /** Consecutive snapshot days (ending at the latest snapshot date) on which it appeared. */
  current_streak: number;
}

/** Same-trend threshold on word-set (Jaccard) similarity. */
export const TREND_SIMILARITY = 0.5;

/** Groups trends across snapshots (exact or similar wording) and counts on how many days each appeared. */
export function recurringTrends(snapshots: readonly MarketSnapshot[]): RecurringTrend[] {
  const clusters: {
    tokens: Set<string>;
    trend: string;
    variants: Set<string>;
    dates: Set<string>;
  }[] = [];
  const chronological = [...snapshots].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const s of chronological) {
    for (const t of s.trends) {
      const tokens = trendTokens(t.trend);
      let best: (typeof clusters)[number] | null = null;
      let bestSim = 0;
      for (const c of clusters) {
        const sim = similarity(tokens, c.tokens);
        if (sim > bestSim) {
          best = c;
          bestSim = sim;
        }
      }
      if (best && bestSim >= TREND_SIMILARITY) {
        best.variants.add(t.trend);
        best.dates.add(s.date);
      } else {
        clusters.push({
          tokens,
          trend: t.trend,
          variants: new Set([t.trend]),
          dates: new Set([s.date]),
        });
      }
    }
  }
  const snapshotDates = [...new Set(chronological.map((s) => s.date))].sort().reverse();
  return clusters
    .map((c) => {
      const dates = [...c.dates].sort();
      let streak = 0;
      for (const d of snapshotDates) {
        if (c.dates.has(d)) streak++;
        else break;
      }
      return {
        trend: c.trend,
        variants: [...c.variants].filter((v) => v !== c.trend),
        days_seen: dates.length,
        dates,
        first_seen: dates[0]!,
        last_seen: dates[dates.length - 1]!,
        current_streak: streak,
      };
    })
    .sort((a, b) => b.days_seen - a.days_seen || b.last_seen.localeCompare(a.last_seen));
}
