import {
  computePositioning,
  SIGNAL_INFO,
  SIGNALS,
  type BrandSignals,
  type SignalName,
} from "../analytics/positioning.js";
import type { AppContext } from "../context.js";
import type { Competitor, WebsiteSnapshot } from "../types/competitor.js";
import { shiftDate } from "../utils/dates.js";

const DISCLAIMER =
  "Market Presence Score is an ESTIMATE from observable signals (ads, website, manual numbers). Competitor sales and revenue are not public; never present this as a sales ranking.";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (v: number | null, dp = 2) =>
  v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp;

export class PositioningService {
  constructor(private readonly ctx: AppContext) {}

  compute() {
    const cfg = this.ctx.business.require();
    this.ctx.services.competitors.syncFromConfig(cfg);
    const repo = this.ctx.repos.competitors;
    const self = repo.getSelf();
    const brands: Competitor[] = [...(self ? [self] : []), ...repo.list()];
    const today = this.ctx.today();

    const prices = cfg.business.products
      .map((p) => p.price)
      .filter((p): p is number => typeof p === "number" && p > 0);
    const ownPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const lastAdDate = this.ctx.repos.ads.lastDate();
    const ownActivity = lastAdDate ? this.ctx.services.analytics.ownAdActivity(lastAdDate) : null;

    const inputs: BrandSignals[] = brands.map((b) => {
      const raw: BrandSignals["raw"] = {};
      const sources: BrandSignals["sources"] = {};
      const set = (s: SignalName, v: number | null, source: string) => {
        raw[s] = v;
        if (v !== null) sources[s] = source;
      };

      // Ads
      if (b.is_self) {
        set(
          "active_ad_count",
          ownActivity?.active_ads ?? null,
          "your ad data (ads with delivery in the last 7 days)",
        );
        set("ad_longevity", ownActivity?.avg_days_running_active ?? null, "your ad data");
        set("creative_velocity", ownActivity?.new_ads_per_week ?? null, "your ad data");
      } else {
        const ads = this.ctx.services.competitors.adsFor(b);
        if (ads.length) {
          const active = ads.filter((a) => a.is_active);
          const since28 = shiftDate(today, -27);
          set("active_ad_count", active.length, "stored competitor ads");
          const days = active.map((a) => a.days_running).filter((d): d is number => d !== null);
          set(
            "ad_longevity",
            days.length ? round(days.reduce((a, d) => a + d, 0) / days.length, 1) : null,
            "stored competitor ads",
          );
          set(
            "creative_velocity",
            round(ads.filter((a) => (a.start_date ?? a.first_seen ?? "") >= since28).length / 4),
            "stored competitor ads",
          );
        }
      }

      // Website
      const snaps: WebsiteSnapshot[] = repo.latestSnapshotsPerUrl(b.id);
      if (snaps.length) {
        const offers = new Set(snaps.flatMap((s) => s.offers.map((o) => o.toLowerCase())));
        const maxDiscount = Math.max(
          0,
          ...[...offers].map((o) => Number(o.match(/(\d{1,2})\s?%/)?.[1] ?? 0)),
        );
        set(
          "offer_aggressiveness",
          round(offers.size + maxDiscount / 10, 1),
          "website snapshots (offer count + max discount %/10)",
        );
        const proof = snaps
          .flatMap((s) => s.social_proof)
          .filter((p) => p.kind === "reviews" || p.kind === "customers");
        set(
          "social_proof",
          Math.max(0, ...proof.map((p) => p.value ?? 0)),
          "website snapshots (largest review/customer count)",
        );
        if (ownPrice) {
          const plausible = snaps
            .flatMap((s) => s.prices)
            .filter(
              (p) =>
                (p.currency === null || p.currency === cfg.business.currency) &&
                p.value >= ownPrice * 0.2 &&
                p.value <= ownPrice * 5,
            )
            .map((p) => p.value);
          const med = median(plausible);
          if (med !== null)
            set(
              "price_position",
              round(med / ownPrice),
              "website snapshots (median price ÷ your avg product price)",
            );
        }
      }
      if (b.is_self && raw.price_position === undefined && ownPrice)
        set("price_position", 1, "business.yaml product prices");

      // Manual signals override derived ones (record_competitor_signal with a signal name from SIGNALS).
      const manual = repo.latestSignals(b.id);
      const aliases: Partial<Record<SignalName, string[]>> = {
        social_following: ["social_followers", "followers", "social_following"],
        web_traffic: ["web_traffic", "monthly_visits"],
        social_proof: ["review_count", "social_proof"],
      };
      for (const s of SIGNALS) {
        for (const name of aliases[s] ?? [s]) {
          const m = manual[name];
          if (m) {
            set(s, m.value, `manual (${name}, ${m.date})`);
            break;
          }
        }
      }
      return { name: b.name, is_self: b.is_self, raw, sources };
    });

    const ranking = computePositioning(inputs, cfg.positioning.weights);
    const gaps = SIGNALS.filter((s) => cfg.positioning.weights[s] > 0)
      .map((s) => ({
        signal: s,
        brands_missing: ranking.filter((r) => r.signals[s].raw === null).map((r) => r.name),
      }))
      .filter((g) => g.brands_missing.length > 0)
      .map((g) => ({ ...g, how_to_fill: howToFill(g.signal) }));
    const selfPos = ranking.find((r) => r.is_self);
    const avgCoverage = ranking.length
      ? ranking.reduce((s, r) => s + r.coverage_pct, 0) / ranking.length
      : 0;

    return {
      summary: selfPos
        ? `${selfPos.name} ranks ${selfPos.rank ?? "n/a"} of ${ranking.length} on estimated market presence (score ${selfPos.presence_score ?? "n/a"}, coverage ${selfPos.coverage_pct}%, ${selfPos.confidence} confidence).`
        : `${ranking.length} brand(s) scored.`,
      disclaimer: DISCLAIMER,
      method:
        "Each signal is scaled 0-100 relative to the best brand on it (log scale for counts; cheapest price = 100), then weighted-averaged over the signals the brand has data for. coverage_pct = share of total weight with data.",
      average_coverage_pct: Math.round(avgCoverage * 10) / 10,
      weights: cfg.positioning.weights,
      signal_definitions: SIGNAL_INFO,
      ranking,
      data_gaps: gaps,
    };
  }
}

function howToFill(s: SignalName): string {
  switch (s) {
    case "active_ad_count":
    case "ad_longevity":
    case "creative_velocity":
      return "fetch_competitor_ads (EU) or import_competitor_ads from data/competitors/<name>.csv; for your own brand, import/sync ad data.";
    case "offer_aggressiveness":
    case "price_position":
      return "snapshot_competitor_websites (and add product/pricing pages as extra_urls in business.yaml).";
    case "social_proof":
      return 'snapshot_competitor_websites, or record_competitor_signal with signal "review_count".';
    case "social_following":
      return 'record_competitor_signal with signal "social_followers" (copy follower counts from their pages).';
    case "web_traffic":
      return 'record_competitor_signal with signal "web_traffic" (monthly visits from a traffic estimation tool).';
  }
}
