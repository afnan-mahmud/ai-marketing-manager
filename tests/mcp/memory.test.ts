import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSameLesson, learningScore, matchesQuery } from "../../src/analytics/memory.js";
import { createTestContext, importSample, TEST_NOW } from "../helpers/context.js";
import { call } from "./performanceTools.test.js";

const UGC = {
  statement: "UGC testimonial videos beat static discount banners for women 20-35 in Dhaka",
  kind: "do",
  category: "creative",
  evidence: "Last 30d: UGC Review CPA 301 vs Static Discount Banner CPA 1136",
  source: "daily_briefing",
};

describe("memory scoring (pure)", () => {
  const base = {
    confidence: "medium" as const,
    confirmations: 1,
    contradictions: 0,
    last_confirmed_at: TEST_NOW.toISOString(),
  };
  it("rewards confirmations and confidence, decays with age, penalises contradictions", () => {
    expect(learningScore(base, TEST_NOW)).toBe(1);
    expect(learningScore({ ...base, confirmations: 4 }, TEST_NOW)).toBe(3);
    expect(learningScore({ ...base, confidence: "high" }, TEST_NOW)).toBe(1.5);
    expect(learningScore({ ...base, contradictions: 1 }, TEST_NOW)).toBe(0.5);
    const ninetyDaysLater = new Date(TEST_NOW.getTime() + 90 * 86_400_000);
    expect(learningScore(base, ninetyDaysLater)).toBe(0.5);
  });
  it("matches the same lesson in other words, only within a category", () => {
    const existing = [{ id: 1, statement: UGC.statement, category: "creative" }];
    expect(
      findSameLesson(
        "For women 20-35 in Dhaka, UGC testimonial videos beat static discount banners",
        "creative",
        existing,
      )?.match.id,
    ).toBe(1);
    expect(findSameLesson(UGC.statement, "audience", existing)).toBeNull();
    expect(
      findSameLesson("Free delivery offers lift conversion rate", "creative", existing),
    ).toBeNull();
    expect(matchesQuery(UGC.statement, "ugc video")).toBe(true);
    expect(matchesQuery(UGC.statement, "lookalike audience")).toBe(false);
  });
});

describe("memory tools", () => {
  it("records, confirms instead of duplicating, and raises confidence with repetition", async () => {
    const ctx = createTestContext({ business: "example" });
    const first = await call(ctx, "record_learning", UGC);
    expect(first.data.outcome).toBe("created");
    expect(first.data.learning).toMatchObject({ id: 1, confidence: "low", confirmations: 1 });
    const again = await call(ctx, "record_learning", {
      ...UGC,
      statement: "For women 20-35 in Dhaka, UGC testimonial videos beat static discount banners",
      evidence: "Week 42: UGC CPA 290 vs banner 1100",
    });
    expect(again.data.outcome).toBe("confirmed");
    expect(again.data.learning).toMatchObject({
      id: 1,
      confirmations: 2,
      confidence: "medium",
      evidence: "Week 42: UGC CPA 290 vs banner 1100",
    });
    const list = await call(ctx, "get_learnings", {});
    expect(list.data.learnings).toHaveLength(1);
  });

  it("flags a contradicting lesson so the user can decide", async () => {
    const ctx = createTestContext({ business: "example" });
    await call(ctx, "record_learning", UGC);
    const r = await call(ctx, "record_learning", {
      ...UGC,
      kind: "avoid",
      statement: "UGC testimonial videos for women 20-35 in Dhaka lose to static discount banners",
      evidence: "November: UGC CPA 700 vs banner 350",
    });
    expect(r.data.outcome).toBe("conflict");
    expect(r.data.conflicts_with).toMatchObject({ id: 1, contradictions: 1 });
    expect(r.data.summary).toContain("Ask the user");
    const brief = await call(ctx, "get_memory_briefing");
    expect(brief.data.conflicts.map((l: { id: number }) => l.id)).toEqual([1]);
  });

  it("ranks the briefing, writes memory.md and supports retire/edit", async () => {
    const ctx = createTestContext({ business: "example" });
    await call(ctx, "record_learning", UGC);
    await call(ctx, "record_learning", {
      ...UGC,
      statement: "Static discount banners waste budget with a slow landing page",
      kind: "avoid",
      confidence: "high",
      evidence: "LPV rate 45%, CPA 1136",
    });
    await call(ctx, "record_learning", {
      statement: "Winter dry-skin searches peak in November in Bangladesh",
      kind: "insight",
      category: "market",
      evidence: "Google Trends 2025",
    });
    const b = await call(ctx, "get_memory_briefing");
    expect(b.data.do.map((l: { id: number }) => l.id)).toEqual([1]);
    expect(b.data.avoid[0]).toMatchObject({ id: 2, score: 1.5 });
    expect(b.data.insights).toHaveLength(1);
    expect(b.data.lessons_by_category).toEqual({ creative: 2, market: 1 });

    const md = readFileSync(join(ctx.paths.dataDir, "memory.md"), "utf8");
    expect(md).toContain("# Marketing memory — Test Project");
    expect(md).toContain("**#2** [creative] Static discount banners waste budget");

    await call(ctx, "update_learning", { id: 3, action: "retire", note: "No longer true" });
    expect(
      (await call(ctx, "get_learnings", {})).data.learnings.map((l: { id: number }) => l.id),
    ).not.toContain(3);
    expect(
      (await call(ctx, "get_learnings", { include_retired: true })).data.learnings,
    ).toHaveLength(3);
    const edited = await call(ctx, "update_learning", {
      id: 1,
      action: "edit",
      statement: "UGC testimonial reels beat static banners for women 20-35",
    });
    expect(edited.data.learning.statement).toBe(
      "UGC testimonial reels beat static banners for women 20-35",
    );
    expect((await call(ctx, "get_learnings", { query: "reels" })).data.learnings[0].id).toBe(1);
    expect((await call(ctx, "update_learning", { id: 99, action: "confirm" })).data.type).toBe(
      "NotFoundError",
    );
  });

  it("rejects vague lessons and keeps memory per project", async () => {
    const a = createTestContext({ business: "example" });
    const b = createTestContext({ business: "example" });
    expect((await call(a, "record_learning", { ...UGC, statement: "good ads" })).isError).toBe(
      true,
    );
    await call(a, "record_learning", UGC);
    expect((await call(b, "get_learnings", {})).data.learnings).toEqual([]);
  });
});

describe("reviewing the outcome of confirmed changes", () => {
  it("compares the target before vs after and links the lesson to the action", async () => {
    // Sample data runs to 2026-10-13; pretend a pause of the fatigued ad's ad set happened on 2026-10-06.
    const ctx = createTestContext({ business: "example" });
    await importSample(ctx);
    const adId = (
      await call(ctx, "get_breakdown", { period: "last_30d", level: "ad" })
    ).data.rows.find((r: { name: string }) => r.name === "Before-After Reel").id;
    const insert = (
      id: string,
      type: string,
      decided: string,
      params: Record<string, unknown>,
      result: Record<string, unknown>,
    ) => {
      ctx.repos.actions.insert({
        id,
        type: type as never,
        summary: `${type} test`,
        params,
        preview: {},
        created_at: decided,
        expires_at: decided,
      });
      ctx.repos.actions.update(id, { status: "executed", decided_at: decided, result });
    };
    insert(
      "AAAA1111",
      "budget_change",
      "2026-10-06T10:00:00.000Z",
      { level: "ad", object_id: adId },
      { object_id: adId },
    );
    insert("BBBB2222", "new_ad", "2026-10-12T10:00:00.000Z", {}, { ad_id: "123" });
    insert("CCCC3333", "new_ad", "2026-10-01T10:00:00.000Z", {}, { ad_id: "999999" });

    const r = await call(ctx, "review_action_outcomes", {});
    const by = Object.fromEntries(
      r.data.reviews.map((x: { action_id: string }) => [x.action_id, x]),
    );
    expect(by.BBBB2222.status).toBe("too_early");
    const budget = by.AAAA1111;
    expect(budget.status).toBe("ready");
    expect(budget.windows).toEqual({
      before: { since: "2026-09-29", until: "2026-10-05" },
      after: { since: "2026-10-07", until: "2026-10-13" },
    });
    expect(budget.target.has_data).toBe(true);
    expect(budget.target_change.cpa.direction).toBe("worse"); // the reel fatigued in that week
    expect(budget.account_change.spend).toBeDefined();
    expect(by.CCCC3333.note).toContain("sync_ads_from_meta");

    const learned = await call(ctx, "record_learning", {
      statement: "Scaling a video ad that already runs at high frequency raises its CPA",
      kind: "avoid",
      category: "budget",
      evidence: `After the change CPA ${budget.target_after.cpa}`,
      source: "action_outcome",
      action_id: "AAAA1111",
    });
    expect(learned.isError).toBe(false);
    const again = await call(ctx, "review_action_outcomes", {});
    expect(again.data.reviews.map((x: { action_id: string }) => x.action_id)).not.toContain(
      "AAAA1111",
    );
    expect(ctx.repos.actions.get("AAAA1111")).toMatchObject({
      learning_id: learned.data.learning.id,
    });
    expect(
      (await call(ctx, "get_memory_briefing")).data.changes_to_review.map(
        (c: { action_id: string }) => c.action_id,
      ),
    ).toEqual(["CCCC3333"]);
  });
});
