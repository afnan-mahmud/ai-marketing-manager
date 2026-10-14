import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { recurringTrends } from "../../src/analytics/trends.js";
import { allPrompts } from "../../src/mcp/prompts/index.js";
import { promptCtxFor } from "../../src/mcp/prompts/common.js";
import { registeredTools } from "../../src/mcp/tools/index.js";
import { createServer } from "../../src/server.js";
import type { MarketSnapshot } from "../../src/types/market.js";
import {
  createExampleProject,
  createTestContext,
  createTestWorkspace,
  importSample,
} from "../helpers/context.js";
import { call } from "./performanceTools.test.js";

describe("recurringTrends", () => {
  const snap = (id: number, date: string, trends: string[]): MarketSnapshot => ({
    id,
    date,
    sector: "skincare",
    summary: "",
    trends: trends.map((trend) => ({ trend })),
    sources: [],
    created_at: date,
  });
  it("groups exact and similar wording and counts streaks", () => {
    const r = recurringTrends([
      snap(1, "2026-10-11", ["Sunscreen demand rising before winter", "Eid gifting bundles"]),
      snap(2, "2026-10-12", ["Rising sunscreen demand before winter"]),
      snap(3, "2026-10-13", ["Sunscreen demand rising before winter", "TikTok shop launch in BD"]),
    ]);
    expect(r[0]).toMatchObject({
      trend: "Sunscreen demand rising before winter",
      days_seen: 3,
      current_streak: 3,
    });
    expect(r[0]!.variants).toEqual(["Rising sunscreen demand before winter"]);
    const eid = r.find((t) => t.trend.startsWith("Eid"))!;
    expect(eid).toMatchObject({ days_seen: 1, current_streak: 0 });
  });
});

describe("market tools", () => {
  it("saves snapshots and reports recurrence", async () => {
    const ctx = createTestContext({ business: "example" });
    const context = await call(ctx, "get_market_context");
    expect(context.data.business.country_name).toBe("Bangladesh");
    expect(context.data.suggested_searches[0]).toContain("skincare");
    const first = await call(ctx, "save_market_snapshot", {
      summary: "Winter skincare season starting.",
      trends: [
        {
          trend: "Winter dry-skin searches up",
          evidence: "Google Trends",
          source_url: "https://trends.google.com/x",
        },
      ],
      sources: ["https://trends.google.com/x"],
    });
    expect(first.data.trend_recurrence[0].days_seen_30d).toBe(1);
    const bad = await call(ctx, "save_market_snapshot", {
      summary: "x",
      trends: [{ trend: "t", source_url: "not a url" }],
    });
    expect(bad.data.type).toBe("ValidationError");
    const history = await call(ctx, "get_market_history", { days: 7 });
    expect(history.data.snapshots).toHaveLength(1);
    expect((await call(ctx, "get_market_context")).data.recent_snapshots).toHaveLength(1);
  });
});

describe("prompts", () => {
  const toolNames = new Set(registeredTools.map((t) => t.name));
  it("only reference tools that exist", () => {
    const ctx = createTestContext({ business: "example" });
    for (const p of allPrompts) {
      const text = p.build({}, promptCtxFor(ctx));
      const referenced = [...text.matchAll(/`([a-z_]+)`/g)]
        .map((m) => m[1]!)
        .filter((n) =>
          /^(get|list|save|import|sync|detect|snapshot|fetch|record|add|remove|update)_/.test(n),
        );
      expect(referenced.length, p.name).toBeGreaterThan(0);
      for (const n of referenced)
        expect(toolNames.has(n), `${p.name} references unknown tool ${n}`).toBe(true);
    }
  });
  it("work without a business profile", () => {
    const ctx = createTestContext();
    for (const p of allPrompts) expect(p.build({}, promptCtxFor(ctx))).toContain("setup_wizard");
    for (const p of allPrompts)
      expect(p.build({}, { project: null, projects: [], today: () => "2026-10-14" })).toContain(
        "create_project",
      );
  });
  it("daily_briefing has the required sections", () => {
    const ctx = createTestContext({ business: "example" });
    const text = allPrompts.find((p) => p.name === "daily_briefing")!.build({}, promptCtxFor(ctx));
    for (const s of [
      "Market today",
      "Competitors",
      "My ads",
      "Me vs competitors",
      "Top 3 actions today",
      "Content idea of the day",
      "save_report",
    ]) {
      expect(text).toContain(s);
    }
  });
});

describe("daily briefing end to end (scripted client following the prompt)", () => {
  it("runs every step over MCP and saves a report", async () => {
    const html = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "web", "competitor-a-v1.html"),
      "utf8",
    );
    const ws = createTestWorkspace({
      fetch: (async (url: string) =>
        url.endsWith("robots.txt")
          ? new Response("", { status: 404 })
          : new Response(url.includes("competitor-b") ? "down" : html, {
              status: url.includes("competitor-b") ? 503 : 200,
              headers: { "content-type": "text/html" },
            })) as typeof fetch,
    });
    const ctx = createExampleProject(ws, "My Brand");
    // Data arrives the way a user would provide it: an export in the inbox.
    await importSample(ctx);
    const server = createServer(ws);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "briefing", version: "1" });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${(r.content as { text: string }[])[0]!.text}`).toBeFalsy();
      return JSON.parse((r.content as { text: string }[])[0]!.text);
    };

    const prompt = await client.getPrompt({ name: "daily_briefing", arguments: {} });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain("get_setup_status");

    const status = await run("get_setup_status");
    expect(status.ready).toBe(true);
    await run("get_market_context");
    await run("save_market_snapshot", {
      summary: "Winter season",
      trends: [{ trend: "Winter skincare demand" }],
      sources: [],
    });
    await run("snapshot_competitor_websites");
    await run("get_competitor_website_changes", { since: "2026-10-13" });
    const pos = await run("get_competitive_positioning");
    expect(pos.ranking.length).toBe(3);
    const yesterday = await run("get_performance_summary", { period: "yesterday" });
    expect(yesterday.period).toEqual({ since: "2026-10-13", until: "2026-10-13" });
    await run("get_performance_summary", { period: "last_7d" });
    const wl = await run("get_winners_and_losers", { period: "last_7d" });
    const fat = await run("detect_creative_fatigue");
    await run("get_funnel_diagnostics", { period: "last_7d" });
    expect(fat.fatigued[0].ad_name).toBe("Before-After Reel");

    const markdown = [
      "# Daily briefing — 2026-10-14",
      "## My ads",
      `- ${yesterday.summary}`,
      `- Winners: ${wl.groups.winner.map((w: { name: string }) => w.name).join(", ")}`,
      `- Fatigued: ${fat.fatigued[0].ad_name}`,
    ].join("\n");
    const saved = await run("save_report", {
      type: "daily_briefing",
      title: "Daily briefing — 2026-10-14",
      markdown,
    });
    expect(saved.report.file).toBe("reports/2026-10-14-daily_briefing.md");
    const latest = await client.readResource({ uri: "marketing://reports/latest" });
    expect((latest.contents[0] as { text: string }).text).toContain("Fatigued: Before-After Reel");
  });
});
