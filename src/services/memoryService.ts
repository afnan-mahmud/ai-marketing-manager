import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { entityId } from "../analytics/aggregate.js";
import { classifyEntities } from "../analytics/classify.js";
import { compareMetrics } from "../analytics/compare.js";
import { compactMetrics, deriveMetrics, sumCounts } from "../analytics/metrics.js";
import {
  confidenceFromConfirmations,
  findSameLesson,
  higherConfidence,
  learningScore,
  matchesQuery,
  MEMORY_HALF_LIFE_DAYS,
  type Confidence,
  type LearningCategory,
  type LearningKind,
} from "../analytics/memory.js";
import type { AppContext } from "../context.js";
import type { AdAction } from "../db/repositories/actionsRepo.js";
import type { Learning, LearningEvent } from "../db/repositories/memoryRepo.js";
import type { Level } from "../types/ads.js";
import type { MetricName } from "../types/metrics.js";
import { daysBetween, shiftDate, toIsoDate } from "../utils/dates.js";
import { AppError, NotFoundError } from "../utils/errors.js";

export interface RecordLearningInput {
  statement: string;
  kind: LearningKind;
  category: LearningCategory;
  evidence: string;
  confidence?: Confidence;
  source?: string;
  tags?: string[];
  related?: string[];
  /** Ads Manager action whose outcome this lesson comes from (marks it reviewed). */
  action_id?: string;
}

/** An action's effect is judged on this many days after it, compared with the same number of days before. */
export const OUTCOME_WINDOW_DAYS = 7;
export const OUTCOME_MIN_DAYS = 3;
const OUTCOME_METRICS: MetricName[] = [
  "spend",
  "conversions",
  "cpa",
  "roas",
  "ctr",
  "cpm",
  "frequency",
];

/**
 * The marketing manager's memory for one client. Claude writes lessons (record_learning) after analysing data;
 * the server de-duplicates, tracks confirmations/contradictions, ranks lessons for recall, and supplies facts about
 * how confirmed Ads Manager changes actually turned out.
 */
export class MemoryService {
  constructor(private readonly ctx: AppContext) {}

  private now(): string {
    return this.ctx.now().toISOString();
  }

  private view(l: Learning) {
    return {
      id: l.id,
      kind: l.kind,
      category: l.category,
      statement: l.statement,
      evidence: l.evidence,
      confidence: l.confidence,
      confirmations: l.confirmations,
      contradictions: l.contradictions,
      score: learningScore(l, this.ctx.now()),
      status: l.status,
      last_confirmed: l.last_confirmed_at.slice(0, 10),
      created: l.created_at.slice(0, 10),
      ...(l.tags.length ? { tags: l.tags } : {}),
      ...(l.related.length ? { related: l.related } : {}),
    };
  }

  private event(l: Learning, event: LearningEvent["event"], note?: string): LearningEvent[] {
    return [...l.history, { at: this.now(), event, ...(note ? { note } : {}) }].slice(-30);
  }

  record(input: RecordLearningInput) {
    const statement = input.statement.trim();
    if (statement.length < 10)
      throw new AppError("Write the lesson as a full sentence (what to do or avoid, and when).");
    const repo = this.ctx.repos.memory;
    const active = repo.list();
    const same = findSameLesson(statement, input.category, active);
    const at = this.now();
    let outcome: "created" | "confirmed" | "conflict";
    let learning: Learning;
    let conflictWith: Learning | null = null;

    const opposite = (a: LearningKind, b: LearningKind) =>
      (a === "do" && b === "avoid") || (a === "avoid" && b === "do");
    if (same && same.match.kind === input.kind) {
      const m = same.match;
      const confirmations = m.confirmations + 1;
      learning = repo.update(m.id, {
        confirmations,
        confidence: higherConfidence(
          higherConfidence(m.confidence, input.confidence ?? "low"),
          confidenceFromConfirmations(confirmations),
        ),
        evidence: input.evidence,
        last_confirmed_at: at,
        updated_at: at,
        related: [...new Set([...m.related, ...(input.related ?? [])])].slice(-20),
        tags: [...new Set([...m.tags, ...(input.tags ?? [])])],
        history: this.event(m, "confirmed", input.evidence),
      });
      outcome = "confirmed";
    } else {
      learning = repo.insert({
        kind: input.kind,
        category: input.category,
        statement,
        evidence: input.evidence,
        source: input.source ?? "other",
        confidence: input.confidence ?? "low",
        tags: input.tags ?? [],
        related: input.related ?? [],
        history: [{ at, event: "created", note: input.evidence }],
        created_at: at,
      });
      outcome = "created";
      if (same && opposite(same.match.kind, input.kind)) {
        conflictWith = repo.update(same.match.id, {
          contradictions: same.match.contradictions + 1,
          updated_at: at,
          history: this.event(same.match, "contradicted", `Lesson #${learning.id}: ${statement}`),
        });
        outcome = "conflict";
      }
    }

    if (input.action_id) {
      const action = this.ctx.repos.actions.get(input.action_id);
      if (action)
        this.ctx.repos.actions.update(action.id, {
          learning_id: learning.id,
          outcome_reviewed_at: at,
        });
    }
    this.writeMemoryFile();
    return {
      summary:
        outcome === "confirmed"
          ? `Lesson #${learning.id} confirmed again (${learning.confirmations}×, ${learning.confidence} confidence).`
          : outcome === "conflict"
            ? `Saved lesson #${learning.id}, but it contradicts lesson #${conflictWith!.id}. Ask the user which holds, then retire the wrong one with update_learning.`
            : `Saved new lesson #${learning.id}.`,
      outcome,
      learning: this.view(learning),
      ...(conflictWith ? { conflicts_with: this.view(conflictWith) } : {}),
      ...(same && outcome !== "confirmed" && !conflictWith
        ? { similar: this.view(same.match) }
        : {}),
    };
  }

  update(input: {
    id: number;
    action: "confirm" | "contradict" | "retire" | "reactivate" | "edit";
    note?: string;
    statement?: string;
    confidence?: Confidence;
  }) {
    const repo = this.ctx.repos.memory;
    const l = repo.get(input.id);
    if (!l)
      throw new NotFoundError(
        `No lesson #${input.id} in this project's memory.`,
        "Use get_learnings.",
      );
    const at = this.now();
    let patch: Partial<Learning>;
    switch (input.action) {
      case "confirm":
        patch = {
          confirmations: l.confirmations + 1,
          confidence: higherConfidence(
            input.confidence ?? l.confidence,
            confidenceFromConfirmations(l.confirmations + 1),
          ),
          last_confirmed_at: at,
          ...(input.note ? { evidence: input.note } : {}),
          history: this.event(l, "confirmed", input.note),
        };
        break;
      case "contradict":
        patch = {
          contradictions: l.contradictions + 1,
          history: this.event(l, "contradicted", input.note),
        };
        break;
      case "retire":
        patch = { status: "retired", history: this.event(l, "retired", input.note) };
        break;
      case "reactivate":
        patch = {
          status: "active",
          last_confirmed_at: at,
          history: this.event(l, "reactivated", input.note),
        };
        break;
      case "edit":
        if (!input.statement && !input.confidence)
          throw new AppError("edit needs a new statement and/or confidence.");
        patch = {
          ...(input.statement ? { statement: input.statement.trim() } : {}),
          ...(input.confidence ? { confidence: input.confidence } : {}),
          history: this.event(
            l,
            "edited",
            input.note ?? (input.statement ? `was: ${l.statement}` : undefined),
          ),
        };
        break;
    }
    const updated = repo.update(l.id, { ...patch, updated_at: at });
    this.writeMemoryFile();
    return { summary: `Lesson #${l.id}: ${input.action} done.`, learning: this.view(updated) };
  }

  /** Lessons ranked by score (confidence × confirmations × recency ÷ contradictions). */
  ranked(
    opts: {
      category?: LearningCategory;
      kind?: LearningKind;
      query?: string;
      includeRetired?: boolean;
    } = {},
  ) {
    return this.ctx.repos.memory
      .list({ includeRetired: opts.includeRetired })
      .filter(
        (l) =>
          (!opts.category || l.category === opts.category) && (!opts.kind || l.kind === opts.kind),
      )
      .filter(
        (l) =>
          !opts.query ||
          matchesQuery(`${l.statement} ${l.tags.join(" ")} ${l.evidence ?? ""}`, opts.query),
      )
      .map((l) => this.view(l))
      .sort((a, b) => b.score - a.score || b.confirmations - a.confirmations);
  }

  list(opts: {
    category?: LearningCategory;
    kind?: LearningKind;
    query?: string;
    include_retired?: boolean;
    limit?: number;
  }) {
    const all = this.ranked({ ...opts, includeRetired: opts.include_retired });
    const shown = all.slice(0, opts.limit ?? 30);
    return {
      summary: all.length
        ? `${all.length} lesson(s) in ${this.ctx.project.name}'s memory${opts.query ? ` matching "${opts.query}"` : ""}.`
        : "No matching lessons yet.",
      learnings: shown,
      truncated: all.length > shown.length,
    };
  }

  /** What to keep in mind before advising today: strongest do/avoid lessons, conflicts, stale lessons, open reviews. */
  briefing() {
    const all = this.ranked();
    const top = (kind: LearningKind, n: number) => all.filter((l) => l.kind === kind).slice(0, n);
    const byCategory: Record<string, number> = {};
    for (const l of all) byCategory[l.category] = (byCategory[l.category] ?? 0) + 1;
    const staleBefore = shiftDate(this.ctx.today(), -MEMORY_HALF_LIFE_DAYS);
    const pending = this.pendingOutcomeActions(OUTCOME_MIN_DAYS);
    return {
      summary: all.length
        ? `${all.length} active lesson(s) for ${this.ctx.project.name}; ${pending.length} change(s) waiting for an outcome review.`
        : `No lessons yet for ${this.ctx.project.name}. Record evidence-based lessons with record_learning after today's analysis.`,
      how_to_use:
        "Follow 'do' lessons and steer clear of 'avoid' lessons unless today's data clearly says otherwise — then say so and update the lesson (update_learning contradict/retire). Cite lesson ids (#n) when a recommendation relies on memory.",
      do: top("do", 8),
      avoid: top("avoid", 8),
      insights: top("insight", 6),
      conflicts: all.filter((l) => l.contradictions > 0).slice(0, 10),
      stale: all.filter((l) => l.last_confirmed < staleBefore).slice(0, 10),
      lessons_by_category: byCategory,
      changes_to_review: pending.map((a) => ({
        action_id: a.id,
        type: a.type,
        summary: a.summary,
        executed: a.decided_at?.slice(0, 10),
      })),
      memory_file: `projects/${this.ctx.project.slug}/memory.md`,
    };
  }

  private pendingOutcomeActions(minDays: number): AdAction[] {
    const today = this.ctx.today();
    return this.ctx.repos.actions
      .list({ status: "executed", limit: 200 })
      .filter(
        (a) =>
          !a.learning_id && a.decided_at && daysBetween(a.decided_at.slice(0, 10), today) > minDays,
      );
  }

  /** The entity an executed action changed or created, as (level, Meta id). */
  private target(a: AdAction): { level: Level; id: string } | null {
    const r = a.result ?? {};
    const p = a.params;
    switch (a.type) {
      case "new_ad":
        return r.ad_id ? { level: "ad", id: String(r.ad_id) } : null;
      case "new_campaign":
        return r.campaign_id ? { level: "campaign", id: String(r.campaign_id) } : null;
      case "new_adset":
        return r.adset_id ? { level: "adset", id: String(r.adset_id) } : null;
      case "duplicate":
        return r.new_id ? { level: p.level as Level, id: String(r.new_id) } : null;
      case "status_change":
      case "budget_change":
        return { level: p.level as Level, id: String(p.object_id) };
    }
  }

  /**
   * Facts about how confirmed Ads Manager changes turned out: the target's metrics in the days after the change vs the
   * same number of days before, plus the whole account's, and a verdict for new ads/ad sets. Claude turns these into
   * lessons with record_learning(action_id=…).
   */
  reviewOutcomes(opts: { min_days?: number; include_reviewed?: boolean } = {}) {
    const minDays = opts.min_days ?? OUTCOME_MIN_DAYS;
    const today = this.ctx.today();
    const yesterday = shiftDate(today, -1);
    const settings = this.ctx.services.analytics.classifySettings();
    const kpi = settings.primary_kpi;
    const candidates = this.ctx.repos.actions
      .list({ status: "executed", limit: 200 })
      .filter((a) => a.decided_at && (opts.include_reviewed || !a.learning_id));

    const reviews = candidates.map((a) => {
      const day = toIsoDate(new Date(a.decided_at!));
      const age = daysBetween(day, today);
      const base = {
        action_id: a.id,
        type: a.type,
        summary: a.summary,
        executed_on: day,
        days_since: age,
        learned_as: a.learning_id ? `#${a.learning_id}` : null,
      };
      if (age <= minDays)
        return {
          ...base,
          status: "too_early",
          note: `Judge after ${minDays + 1} full days of data.`,
        };
      const after = {
        since: shiftDate(day, 1),
        until: shiftDate(day, Math.min(OUTCOME_WINDOW_DAYS, age - 1)),
      };
      if (after.until > yesterday) after.until = yesterday;
      const len = daysBetween(after.since, after.until) + 1;
      const before = { since: shiftDate(day, -len), until: shiftDate(day, -1) };
      const target = this.target(a);
      const rowsAfter = this.ctx.repos.ads.getDaily(after);
      const rowsBefore = this.ctx.repos.ads.getDaily(before);
      const pick = (rows: typeof rowsAfter) =>
        target ? rows.filter((r) => entityId(r, target.level) === target.id) : [];
      const tAfter = deriveMetrics(sumCounts(pick(rowsAfter)), kpi);
      const tBefore = deriveMetrics(sumCounts(pick(rowsBefore)), kpi);
      const accAfter = deriveMetrics(sumCounts(rowsAfter), kpi);
      const accBefore = deriveMetrics(sumCounts(rowsBefore), kpi);
      const hasTargetData = pick(rowsAfter).length > 0 || pick(rowsBefore).length > 0;
      const created =
        a.type === "new_ad" ||
        a.type === "new_campaign" ||
        a.type === "new_adset" ||
        a.type === "duplicate";
      const verdict =
        created && hasTargetData
          ? (classifyEntities([{ id: "t", metrics: tAfter }], settings).get("t") ?? null)
          : null;
      const outcome = {
        ...base,
        status: hasTargetData || rowsAfter.length ? "ready" : "no_data",
        windows: { before, after },
        target: target ? { ...target, has_data: hasTargetData } : null,
        target_after: hasTargetData ? compactMetrics(tAfter, OUTCOME_METRICS) : null,
        ...(hasTargetData && !created
          ? { target_change: compareMetrics(tAfter, tBefore, OUTCOME_METRICS) }
          : {}),
        ...(verdict ? { verdict_after: verdict } : {}),
        account_change:
          rowsAfter.length && rowsBefore.length
            ? compareMetrics(accAfter, accBefore, OUTCOME_METRICS)
            : null,
        ...(!hasTargetData
          ? {
              note: "No rows for this Meta id: sync with sync_ads_from_meta (exports without the Ad ID column can't be matched).",
            }
          : {}),
      };
      if (outcome.status === "ready")
        this.ctx.repos.actions.update(a.id, {
          outcome: outcome as unknown as Record<string, unknown>,
        });
      return outcome;
    });
    const ready = reviews.filter((r) => r.status === "ready");
    return {
      summary: `${ready.length} change(s) ready to judge, ${reviews.length - ready.length} too early or without data.`,
      how_to_use:
        "For each ready change, decide what it teaches (worked / didn't / unclear — mind other changes in the same window) and save it with record_learning, passing action_id so it isn't reviewed again.",
      primary_kpi: kpi,
      reviews,
    };
  }

  /** Human-readable snapshot of the memory at projects/<client>/memory.md (regenerated on every change). */
  writeMemoryFile(): void {
    const all = this.ranked();
    const section = (kind: LearningKind, title: string) => {
      const items = all.filter((l) => l.kind === kind);
      if (!items.length) return [`## ${title}`, "", "_None yet._", ""];
      return [
        `## ${title}`,
        "",
        ...items.map(
          (l) =>
            `- **#${l.id}** [${l.category}] ${l.statement} — _${l.confidence}, confirmed ${l.confirmations}×${l.contradictions ? `, contradicted ${l.contradictions}×` : ""}, last ${l.last_confirmed}_${l.evidence ? `\n  - Evidence: ${l.evidence.replace(/\n/g, " ")}` : ""}`,
        ),
        "",
      ];
    };
    const md = [
      `# Marketing memory — ${this.ctx.project.name}`,
      "",
      `_Generated ${this.ctx.today()} from the project database. Edit lessons through Claude (update_learning), not here._`,
      "",
      ...section("do", "Do (what works)"),
      ...section("avoid", "Avoid (what didn't work)"),
      ...section("insight", "Insights"),
    ].join("\n");
    try {
      writeFileSync(join(this.ctx.paths.dataDir, "memory.md"), md + "\n", "utf8");
    } catch {
      /* the database is the source of truth; the file is a convenience */
    }
  }
}
