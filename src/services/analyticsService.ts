import {
  aggregateBy,
  aggregateByDay,
  filterByEntity,
  type EntityAggregate,
} from "../analytics/aggregate.js";
import { budgetEfficiency } from "../analytics/budget.js";
import { classifyEntities, type ClassifySettings, type Classified } from "../analytics/classify.js";
import { compareMetrics } from "../analytics/compare.js";
import { diagnose, funnelSteps, BENCHMARKS } from "../analytics/diagnostics.js";
import { evaluateFatigue } from "../analytics/fatigue.js";
import {
  ALL_METRIC_NAMES,
  compactMetrics,
  deriveMetrics,
  roundMetric,
  roundMetricSet,
  sumCounts,
} from "../analytics/metrics.js";
import { defaultAnalysisSettings, type BusinessConfig } from "../config/business.js";
import type { AppContext } from "../context.js";
import type { AdCreative, AdDailyRow, Level } from "../types/ads.js";
import type { MetricName, MetricSet, Verdict } from "../types/metrics.js";
import {
  daysBetween,
  listDates,
  previousPeriod,
  rangeLength,
  resolvePeriod,
  shiftDate,
  type DateRange,
  type Period,
} from "../utils/dates.js";
import { NoDataError, NotFoundError } from "../utils/errors.js";
import { formatMoney, formatPct } from "../utils/money.js";

export interface AnalysisContext {
  range: DateRange;
  settings: ClassifySettings;
  currency: string | null;
  warnings: string[];
  data_last_date: string | null;
  anchor_today: string;
  business: BusinessConfig | null;
}

/** Days in the "recent" window used for fatigue inside a period, and the baseline length before it. */
const FATIGUE_RECENT_MAX_DAYS = 7;
const FATIGUE_BASELINE_DAYS = 14;
const STALE_AFTER_DAYS = 2;

export type VerdictGroups = Record<Verdict, ReturnType<AnalyticsService["adRow"]>[]>;

export class AnalyticsService {
  constructor(private readonly ctx: AppContext) {}

  // ---------- shared plumbing ----------

  /**
   * Resolves the period and settings. Relative periods ("yesterday", "last_7d"…) are anchored to today,
   * unless stored data ends earlier — then they anchor to the last data day (with a warning) so the
   * analysis still covers real data.
   */
  prepare(period: Period): AnalysisContext {
    const warnings: string[] = [];
    const business = this.ctx.business.tryLoad();
    const cfgState = this.ctx.business.load();
    if (cfgState.status === "missing") {
      warnings.push(
        "No projects/<project>/business.yaml: using default thresholds and primary KPI = purchases, with no CPA/ROAS targets.",
      );
    } else if (cfgState.status === "invalid") {
      warnings.push(
        `projects/<project>/business.yaml is invalid (${cfgState.issues.join("; ")}); using default thresholds.`,
      );
    }
    const settings: ClassifySettings = business
      ? {
          primary_kpi: business.goals.primary_kpi,
          targets: business.goals.targets,
          ...business.classification,
        }
      : {
          primary_kpi: defaultAnalysisSettings.primary_kpi,
          targets: defaultAnalysisSettings.targets,
          ...defaultAnalysisSettings.classification,
        };

    const lastDate = this.ctx.repos.ads.lastDate();
    if (!lastDate) throw new NoDataError("No ad data has been imported yet.");
    const today = this.ctx.today();
    let anchor = today;
    const age = daysBetween(lastDate, today);
    if (age > STALE_AFTER_DAYS) {
      warnings.push(
        `Data is stale: the latest data is from ${lastDate} (${age} days ago). Import a fresh export or run sync_ads_from_meta.`,
      );
    }
    if (typeof period === "string" && lastDate < shiftDate(today, -1)) {
      anchor = shiftDate(lastDate, 1);
      warnings.push(
        `Relative period "${period}" was anchored to the last data day (${lastDate}) instead of yesterday.`,
      );
    }
    const range = resolvePeriod(period, anchor);
    return {
      range,
      settings,
      currency: business?.business.currency ?? null,
      warnings,
      data_last_date: lastDate,
      anchor_today: anchor,
      business,
    };
  }

  private rowsOrThrow(range: DateRange): AdDailyRow[] {
    const rows = this.ctx.repos.ads.getDaily(range);
    if (rows.length === 0)
      throw new NoDataError(`No ad data between ${range.since} and ${range.until}.`);
    return rows;
  }

  private metricsOf(e: EntityAggregate, a: AnalysisContext): MetricSet {
    return deriveMetrics(e.counts, a.settings.primary_kpi);
  }

  private thinDataWarning(totals: MetricSet, a: AnalysisContext): void {
    if (totals.spend < a.settings.min_spend_for_verdict) {
      a.warnings.push(
        `Thin data: total spend ${roundMetric("spend", totals.spend)} is below min_spend_for_verdict (${a.settings.min_spend_for_verdict}); verdicts are unreliable.`,
      );
    }
  }

  private money(v: number | null, a: AnalysisContext): string {
    return a.currency
      ? formatMoney(roundMetric("spend", v), a.currency)
      : String(roundMetric("spend", v) ?? "n/a");
  }

  private meta(a: AnalysisContext) {
    return {
      period: a.range,
      currency: a.currency,
      primary_kpi: a.settings.primary_kpi,
      data_last_date: a.data_last_date,
      warnings: a.warnings,
    };
  }

  adRow(e: EntityAggregate, m: MetricSet, c: Classified | undefined, creative?: AdCreative) {
    return {
      level: e.level,
      id: e.id,
      name: e.name,
      ...(e.level !== "campaign" ? { campaign: e.campaign_name } : {}),
      ...(e.level === "ad" ? { adset: e.adset_name } : {}),
      verdict: c?.verdict ?? null,
      reasons: c?.reasons ?? [],
      metrics: compactMetrics(m),
      first_date: e.first_date,
      last_date: e.last_date,
      ...(creative ? { creative } : {}),
    };
  }

  /** Classifies ads in `range` and layers fatigue on top using each ad's own baseline before the recent window. */
  private classifyAdsWithFatigue(rows: AdDailyRow[], a: AnalysisContext, recentDays?: number) {
    const ads = aggregateBy(rows, "ad");
    const metrics = new Map(ads.map((e) => [e.id, this.metricsOf(e, a)]));
    const verdicts = classifyEntities(
      ads.map((e) => ({ id: e.id, metrics: metrics.get(e.id)! })),
      a.settings,
    );
    const fatigue = this.fatigueFor(
      a.range.until,
      recentDays ?? Math.min(FATIGUE_RECENT_MAX_DAYS, rangeLength(a.range)),
      a,
    );
    for (const [id, f] of fatigue.map) {
      if (f.result.fatigued && verdicts.get(id)?.verdict !== "learning") {
        verdicts.set(id, { verdict: "fatigued", reasons: f.result.reasons });
      }
    }
    return { ads, metrics, verdicts, fatigue };
  }

  /** Recent window ending `until` vs the baseline window right before it, per ad. */
  private fatigueFor(until: string, recentDays: number, a: AnalysisContext) {
    const recentRange = { since: shiftDate(until, -(recentDays - 1)), until };
    const baselineRange = {
      since: shiftDate(recentRange.since, -FATIGUE_BASELINE_DAYS),
      until: shiftDate(recentRange.since, -1),
    };
    const recentAds = aggregateBy(this.ctx.repos.ads.getDaily(recentRange), "ad");
    const baselineAds = aggregateBy(this.ctx.repos.ads.getDaily(baselineRange), "ad");
    const baselineMetrics = new Map(baselineAds.map((e) => [e.id, this.metricsOf(e, a)]));
    const baselineVerdicts = classifyEntities(
      baselineAds.map((e) => ({ id: e.id, metrics: baselineMetrics.get(e.id)! })),
      a.settings,
    );
    const out = new Map<
      string,
      {
        entity: EntityAggregate;
        recent: MetricSet;
        baseline: MetricSet | null;
        result: ReturnType<typeof evaluateFatigue>;
      }
    >();
    for (const e of recentAds) {
      const recent = this.metricsOf(e, a);
      const baseline = baselineMetrics.get(e.id) ?? null;
      const result = baseline
        ? evaluateFatigue(
            { recent, baseline, baselineVerdict: baselineVerdicts.get(e.id)?.verdict ?? "average" },
            {
              frequencyThreshold: a.settings.fatigue_frequency,
              minImpressions: Math.round(a.settings.min_impressions_for_verdict / 2),
            },
          )
        : {
            fatigued: false,
            watch: false,
            reasons: [{ code: "NO_BASELINE", note: "Ad has no data before the recent window." }],
          };
      out.set(e.id, { entity: e, recent, baseline, result });
    }
    return { map: out, recentRange, baselineRange };
  }

  // ---------- tools ----------

  performanceSummary(period: Period, compare = true) {
    const a = this.prepare(period);
    const rows = this.rowsOrThrow(a.range);
    const totals = deriveMetrics(sumCounts(rows), a.settings.primary_kpi);
    this.thinDataWarning(totals, a);
    const prevRange = previousPeriod(a.range);
    const prevRows = compare ? this.ctx.repos.ads.getDaily(prevRange) : [];
    const prevTotals = deriveMetrics(sumCounts(prevRows), a.settings.primary_kpi);
    const comparison =
      compare && prevRows.length > 0 ? compareMetrics(totals, prevTotals, ALL_METRIC_NAMES) : null;
    if (compare && prevRows.length === 0)
      a.warnings.push(
        `No data for the previous period ${prevRange.since}..${prevRange.until}; no comparison.`,
      );

    const t = a.settings.targets;
    const vsTargets = {
      ...(t.max_cpa !== undefined
        ? {
            cpa: {
              value: roundMetric("cpa", totals.cpa),
              target: t.max_cpa,
              meets: totals.cpa !== null && totals.cpa <= t.max_cpa,
            },
          }
        : {}),
      ...(t.min_roas !== undefined
        ? {
            roas: {
              value: roundMetric("roas", totals.roas),
              target: t.min_roas,
              meets: totals.roas !== null && totals.roas >= t.min_roas,
            },
          }
        : {}),
      ...(t.min_ctr_pct !== undefined
        ? {
            ctr: {
              value: roundMetric("ctr", totals.ctr),
              target: t.min_ctr_pct / 100,
              meets: totals.ctr !== null && totals.ctr >= t.min_ctr_pct / 100,
            },
          }
        : {}),
    };

    const delta = comparison?.cpa?.delta_pct;
    return {
      summary:
        `${a.range.since}..${a.range.until}: spent ${this.money(totals.spend, a)}, ${totals.conversions} ${a.settings.primary_kpi}, ` +
        `CPA ${this.money(totals.cpa, a)}${delta !== null && delta !== undefined ? ` (${delta > 0 ? "+" : ""}${delta}% vs previous)` : ""}, ` +
        `ROAS ${roundMetric("roas", totals.roas) ?? "n/a"}, CTR ${formatPct(totals.ctr)}.`,
      ...this.meta(a),
      totals: roundMetricSet(totals),
      vs_targets: vsTargets,
      previous_period: compare ? prevRange : null,
      comparison,
      active: {
        campaigns: aggregateBy(rows, "campaign").filter((e) => e.counts.spend > 0).length,
        adsets: aggregateBy(rows, "adset").filter((e) => e.counts.spend > 0).length,
        ads: aggregateBy(rows, "ad").filter((e) => e.counts.spend > 0).length,
      },
    };
  }

  breakdown(period: Period, level: Level, sortBy: MetricName = "spend", limit = 25) {
    const a = this.prepare(period);
    const rows = this.rowsOrThrow(a.range);
    let verdicts: Map<string, Classified>;
    const entities = aggregateBy(rows, level);
    const metrics = new Map(entities.map((e) => [e.id, this.metricsOf(e, a)]));
    if (level === "ad") verdicts = this.classifyAdsWithFatigue(rows, a).verdicts;
    else
      verdicts = classifyEntities(
        entities.map((e) => ({ id: e.id, metrics: metrics.get(e.id)! })),
        a.settings,
      );
    const ascending = sortBy === "cpa" || sortBy === "cpc" || sortBy === "cpm";
    const sorted = [...entities].sort((x, y) => {
      const vx = metrics.get(x.id)![sortBy];
      const vy = metrics.get(y.id)![sortBy];
      if (vx === null && vy === null) return 0;
      if (vx === null) return 1;
      if (vy === null) return -1;
      return ascending ? vx - vy : vy - vx;
    });
    const totals = deriveMetrics(sumCounts(rows), a.settings.primary_kpi);
    const shown = sorted.slice(0, limit);
    return {
      summary: `${entities.length} ${level}(s) in ${a.range.since}..${a.range.until}, sorted by ${sortBy}${ascending ? " (lowest first)" : ""}; showing ${shown.length}.`,
      ...this.meta(a),
      level,
      sort_by: sortBy,
      totals: compactMetrics(totals),
      rows: shown.map((e) => this.adRow(e, metrics.get(e.id)!, verdicts.get(e.id))),
      truncated: entities.length > shown.length,
    };
  }

  dailyTrend(period: Period, metricNames: MetricName[], level?: Level, entityIdArg?: string) {
    const a = this.prepare(period);
    let rows = this.rowsOrThrow(a.range);
    let entity: { level: Level; id: string; name: string } | null = null;
    if (entityIdArg) {
      const lvl = level ?? "ad";
      rows = filterByEntity(rows, lvl, entityIdArg);
      if (rows.length === 0)
        throw new NotFoundError(
          `No ${lvl} with id "${entityIdArg}" in this period. Use get_breakdown to find ids.`,
        );
      entity = { level: lvl, id: entityIdArg, name: aggregateBy(rows, lvl)[0]!.name };
    }
    const dates = listDates(a.range);
    const series = aggregateByDay(rows, dates).map(({ date, counts }) => {
      const m = deriveMetrics(counts, a.settings.primary_kpi);
      const point: Record<string, number | string | null> = { date };
      for (const n of metricNames) point[n] = roundMetric(n, m[n] ?? null);
      return point;
    });
    const missing = series
      .filter((p) => metricNames.every((n) => p[n] === 0 || p[n] === null))
      .map((p) => p.date as string);
    if (missing.length)
      a.warnings.push(
        `No data on ${missing.length} day(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`,
      );
    const total = deriveMetrics(sumCounts(rows), a.settings.primary_kpi);
    return {
      summary: `Daily ${metricNames.join(", ")} for ${entity ? `${entity.level} "${entity.name}"` : "the account"}, ${a.range.since}..${a.range.until} (${dates.length} days).`,
      ...this.meta(a),
      entity,
      metrics: metricNames,
      period_total: Object.fromEntries(
        metricNames.map((n) => [n, roundMetric(n, total[n] ?? null)]),
      ),
      series,
    };
  }

  winnersAndLosers(period: Period, limit = 10) {
    const a = this.prepare(period);
    const rows = this.rowsOrThrow(a.range);
    const { ads, metrics, verdicts } = this.classifyAdsWithFatigue(rows, a);
    const totals = deriveMetrics(sumCounts(rows), a.settings.primary_kpi);
    this.thinDataWarning(totals, a);
    const groups: VerdictGroups = {
      winner: [],
      fatigued: [],
      loser: [],
      average: [],
      learning: [],
    };
    const sorted = [...ads].sort((x, y) => y.counts.spend - x.counts.spend);
    for (const e of sorted) {
      const c = verdicts.get(e.id)!;
      groups[c.verdict].push(this.adRow(e, metrics.get(e.id)!, c));
    }
    const counts = Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [k, v.length]),
    ) as Record<Verdict, number>;
    const spendBy = (v: Verdict) =>
      groups[v].reduce((s, r) => s + ((r.metrics.spend as number) ?? 0), 0);
    for (const k of Object.keys(groups) as Verdict[]) groups[k] = groups[k].slice(0, limit);
    const t = a.settings.targets;
    return {
      summary: `${ads.length} ads: ${counts.winner} winner(s), ${counts.fatigued} fatigued, ${counts.loser} loser(s), ${counts.average} average, ${counts.learning} learning.`,
      ...this.meta(a),
      basis:
        t.max_cpa !== undefined || t.min_roas !== undefined
          ? {
              method: "targets",
              max_cpa: t.max_cpa ?? null,
              min_roas: t.min_roas ?? null,
              loser_cpa_multiple: 1.5,
            }
          : {
              method: "account_quartiles",
              note: "No CPA/ROAS targets in business.yaml: winners are the cheapest 25% by CPA, losers the most expensive 25%.",
            },
      thresholds: {
        min_spend_for_verdict: a.settings.min_spend_for_verdict,
        min_impressions_for_verdict: a.settings.min_impressions_for_verdict,
        fatigue_frequency: a.settings.fatigue_frequency,
      },
      counts,
      spend_share_by_verdict: Object.fromEntries(
        (Object.keys(groups) as Verdict[]).map((v) => [
          v,
          totals.spend ? Math.round((spendBy(v) / totals.spend) * 10000) / 10000 : null,
        ]),
      ),
      groups,
    };
  }

  creativeFatigue(lookbackDays = 7) {
    const a = this.prepare("yesterday");
    const until = a.range.until;
    const f = this.fatigueFor(until, lookbackDays, a);
    const fatigued: unknown[] = [];
    const watchlist: unknown[] = [];
    for (const [, v] of f.map) {
      const item = {
        ad_id: v.entity.id,
        ad_name: v.entity.name,
        campaign: v.entity.campaign_name,
        adset: v.entity.adset_name,
        recent: compactMetrics(v.recent, [
          "spend",
          "impressions",
          "frequency",
          "ctr",
          "cpa",
          "conversions",
          "hook_rate",
        ]),
        baseline: v.baseline
          ? compactMetrics(v.baseline, [
              "spend",
              "impressions",
              "frequency",
              "ctr",
              "cpa",
              "conversions",
              "hook_rate",
            ])
          : null,
        evidence: v.result.reasons,
      };
      if (v.result.fatigued) fatigued.push(item);
      else if (v.result.watch) watchlist.push(item);
    }
    return {
      summary: `${fatigued.length} fatigued ad(s), ${watchlist.length} on the watchlist (recent ${f.recentRange.since}..${f.recentRange.until} vs baseline ${f.baselineRange.since}..${f.baselineRange.until}).`,
      ...this.meta(a),
      period: f.recentRange,
      recent_window: f.recentRange,
      baseline_window: f.baselineRange,
      rule: `Former winner (baseline) AND recent frequency ≥ ${a.settings.fatigue_frequency} AND (CTR down ≥ 20% OR CPA up ≥ 25%).`,
      fatigued,
      watchlist,
    };
  }

  funnelDiagnostics(period: Period, level?: Level, entityIdArg?: string) {
    const a = this.prepare(period);
    let rows = this.rowsOrThrow(a.range);
    const minCtr =
      a.settings.targets.min_ctr_pct !== undefined
        ? a.settings.targets.min_ctr_pct / 100
        : undefined;
    let prevRows = this.ctx.repos.ads.getDaily(previousPeriod(a.range));
    let scope: { level: Level | "account"; id: string | null; name: string } = {
      level: "account",
      id: null,
      name: "Account",
    };
    if (entityIdArg) {
      const lvl = level ?? "ad";
      rows = filterByEntity(rows, lvl, entityIdArg);
      if (rows.length === 0)
        throw new NotFoundError(`No ${lvl} with id "${entityIdArg}" in this period.`);
      prevRows = filterByEntity(prevRows, lvl, entityIdArg);
      scope = { level: lvl, id: entityIdArg, name: aggregateBy(rows, lvl)[0]!.name };
    }
    const m = deriveMetrics(sumCounts(rows), a.settings.primary_kpi);
    const prev = prevRows.length
      ? deriveMetrics(sumCounts(prevRows), a.settings.primary_kpi)
      : undefined;
    const flags = diagnose(m, { minCtr, previous: prev });

    // Per-entity flags (ad level by default) to show *where* the problems are.
    const entityLevel: Level = level ?? "ad";
    const prevByEntity = new Map(
      aggregateBy(prevRows, entityLevel).map((e) => [e.id, this.metricsOf(e, a)]),
    );
    const entities = entityIdArg
      ? []
      : aggregateBy(rows, entityLevel)
          .sort((x, y) => y.counts.spend - x.counts.spend)
          .map((e) => {
            const em = this.metricsOf(e, a);
            return {
              level: entityLevel,
              id: e.id,
              name: e.name,
              spend: roundMetric("spend", em.spend),
              flags: diagnose(em, { minCtr, previous: prevByEntity.get(e.id) }),
              rates: compactMetrics(em, [
                "ctr",
                "lpv_rate",
                "atc_rate",
                "checkout_rate",
                "purchase_rate",
                "hook_rate",
                "hold_rate",
              ]),
            };
          })
          .filter((e) => e.flags.length > 0);
    return {
      summary: `${scope.name}: ${flags.length} funnel flag(s)${entities.length ? `; ${entities.length} ${entityLevel}(s) with their own flags` : ""}.`,
      ...this.meta(a),
      scope,
      funnel: funnelSteps(m),
      rates: compactMetrics(m, [
        "ctr",
        "lpv_rate",
        "atc_rate",
        "checkout_rate",
        "purchase_rate",
        "conversion_rate",
        "hook_rate",
        "hold_rate",
      ]),
      flags,
      entities_with_flags: entities,
      benchmarks: BENCHMARKS,
    };
  }

  budgetData(period: Period) {
    const a = this.prepare(period);
    const rows = this.rowsOrThrow(a.range);
    const levelData = (level: "campaign" | "adset") => {
      const ents = aggregateBy(rows, level);
      const metrics = new Map(ents.map((e) => [e.id, this.metricsOf(e, a)]));
      const verdicts = classifyEntities(
        ents.map((e) => ({ id: e.id, metrics: metrics.get(e.id)! })),
        a.settings,
      );
      return budgetEfficiency(
        ents.map((e) => ({
          id: e.id,
          name: level === "adset" ? `${e.campaign_name ?? ""} › ${e.name}` : e.name,
          spend: e.counts.spend,
          conversions: metrics.get(e.id)!.conversions,
          verdict: verdicts.get(e.id)?.verdict,
          cpa: roundMetric("cpa", metrics.get(e.id)!.cpa),
          roas: roundMetric("roas", metrics.get(e.id)!.roas),
        })),
      );
    };
    const campaigns = levelData("campaign");
    const adsets = levelData("adset");
    const days = rangeLength(a.range);
    const monthly = a.business?.goals.monthly_budget;
    const pacing = monthly
      ? {
          monthly_budget: monthly,
          avg_daily_spend: Math.round((campaigns.total_spend / days) * 100) / 100,
          projected_30d_spend: Math.round((campaigns.total_spend / days) * 30 * 100) / 100,
          projected_vs_budget_pct:
            Math.round((((campaigns.total_spend / days) * 30) / monthly) * 10000) / 100,
        }
      : null;
    return {
      summary: `${campaigns.over_funded_losers.length + adsets.over_funded_losers.length} over-funded and ${campaigns.under_funded_winners.length + adsets.under_funded_winners.length} under-funded entities found (suggestions only — changing a budget needs propose_budget_change + the user's confirmation).`,
      ...this.meta(a),
      method:
        "efficiency_index = share of conversions / share of spend. Under-funded candidate: index ≥ 1.3, or a winner with index ≥ 1. Over-funded candidate: index < 0.7, a loser, or no conversions (with ≥ 5% of spend).",
      pacing,
      campaigns,
      adsets,
    };
  }

  topCreatives(period: Period, limit = 5, by: "cpa" | "roas" | "ctr" | "hook_rate" = "cpa") {
    const a = this.prepare(period);
    const rows = this.rowsOrThrow(a.range);
    const { ads, metrics, verdicts } = this.classifyAdsWithFatigue(rows, a);
    const candidates = ads.filter(
      (e) => verdicts.get(e.id)?.verdict !== "learning" && metrics.get(e.id)![by] !== null,
    );
    const asc = by === "cpa";
    candidates.sort((x, y) => {
      const vx = metrics.get(x.id)![by]!;
      const vy = metrics.get(y.id)![by]!;
      return asc ? vx - vy : vy - vx;
    });
    const top = candidates.slice(0, limit);
    const creatives = this.ctx.repos.ads.getCreatives(top.map((e) => e.id));
    const missingCopy = top.filter((e) => !creatives.has(e.id)).length;
    if (missingCopy > 0) {
      a.warnings.push(
        `${missingCopy} top ad(s) have no stored copy. Add Headline/Body/Call to action columns to your export, or run sync_ads_from_meta to fetch creatives.`,
      );
    }
    return {
      summary: `Top ${top.length} ads by ${by} (${asc ? "lowest" : "highest"} first) in ${a.range.since}..${a.range.until}, with their copy.`,
      ...this.meta(a),
      ranked_by: by,
      ads: top.map((e, i) => ({
        rank: i + 1,
        ...this.adRow(e, metrics.get(e.id)!, verdicts.get(e.id), creatives.get(e.id)),
      })),
    };
  }

  /** Small digest used by other services (positioning, reports): active ads, ad ages, launches. */
  ownAdActivity(asOf: string) {
    const lifetimes = this.ctx.repos.ads.getAdLifetimes();
    const activeSince = shiftDate(asOf, -6);
    const active = lifetimes.filter((l) => l.last_date >= activeSince);
    const launched28d = lifetimes.filter((l) => l.first_date >= shiftDate(asOf, -27));
    return {
      active_ads: active.length,
      avg_days_running_active: active.length
        ? Math.round(
            (active.reduce((s, l) => s + daysBetween(l.first_date, l.last_date) + 1, 0) /
              active.length) *
              10,
          ) / 10
        : null,
      new_ads_per_week: Math.round((launched28d.length / 4) * 100) / 100,
    };
  }
}
