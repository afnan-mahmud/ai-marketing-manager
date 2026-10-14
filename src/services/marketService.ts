import { recurringTrends } from "../analytics/trends.js";
import type { AppContext } from "../context.js";
import type { MarketTrend } from "../types/market.js";
import { shiftDate } from "../utils/dates.js";

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export class MarketService {
  constructor(private readonly ctx: AppContext) {}

  context() {
    const cfg = this.ctx.business.require();
    const b = cfg.business;
    const recent = this.ctx.repos.market.latest(7);
    const history = this.ctx.repos.market.since(shiftDate(this.ctx.today(), -30));
    const country = countryName(b.country);
    const year = this.ctx.today().slice(0, 4);
    return {
      summary: `${b.sector} in ${country}; ${recent.length} recent market snapshot(s)${recent[0] ? `, latest ${recent[0].date}` : ""}.`,
      today: this.ctx.today(),
      business: {
        name: b.name,
        sector: b.sector,
        country: b.country,
        country_name: country,
        language: b.language,
        currency: b.currency,
        target_audience: b.target_audience ?? null,
        brand_voice: b.brand_voice ?? null,
        products: b.products,
      },
      competitors: cfg.competitors.map((c) => c.name),
      recent_snapshots: recent,
      recurring_trends_30d: recurringTrends(history)
        .filter((t) => t.days_seen > 1)
        .slice(0, 15),
      suggested_searches: [
        `${b.sector} market trends ${country} ${year}`,
        `${b.sector} news ${country} this week`,
        `${b.sector} social media trends ${year}`,
        ...b.products.slice(0, 2).map((p) => `${p.name} ${country} price`),
        ...cfg.competitors.slice(0, 3).map((c) => `${c.name} ${country}`),
        `upcoming holidays shopping events ${country}`,
      ],
      instructions:
        "Research with your own web search, then call save_market_snapshot. When a trend from recent_snapshots is still relevant, reuse its exact wording so recurrence is counted.",
    };
  }

  save(input: { summary: string; trends: MarketTrend[]; sources: string[] }) {
    const cfg = this.ctx.business.tryLoad();
    const snap = this.ctx.repos.market.insert({
      date: this.ctx.today(),
      sector: cfg?.business.sector ?? null,
      summary: input.summary,
      trends: input.trends,
      sources: input.sources,
    });
    const history = this.ctx.repos.market.since(shiftDate(this.ctx.today(), -30));
    const recurring = recurringTrends(history);
    const forToday = input.trends.map((t) => {
      const r = recurring.find((x) => x.trend === t.trend || x.variants.includes(t.trend));
      return {
        trend: t.trend,
        days_seen_30d: r?.days_seen ?? 1,
        current_streak: r?.current_streak ?? 1,
      };
    });
    return {
      summary: `Saved market snapshot #${snap.id} for ${snap.date} with ${input.trends.length} trend(s).`,
      snapshot_id: snap.id,
      date: snap.date,
      trend_recurrence: forToday,
    };
  }

  history(days = 30) {
    const since = shiftDate(this.ctx.today(), -days);
    const snaps = this.ctx.repos.market.since(since);
    const recurring = recurringTrends(snaps);
    return {
      summary: `${snaps.length} market snapshot(s) since ${since}; ${recurring.filter((t) => t.days_seen > 1).length} recurring trend(s).`,
      since,
      recurring_trends: recurring,
      snapshots: snaps,
    };
  }
}
