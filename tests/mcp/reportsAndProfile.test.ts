import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/context.js";
import { call } from "./performanceTools.test.js";

describe("reports", () => {
  it("saves, replaces same-day reports, lists and reads them", async () => {
    const ctx = createTestContext();
    const first = await call(ctx, "save_report", {
      type: "daily_briefing",
      title: "Briefing",
      markdown: "Hello",
    });
    expect(first.isError).toBe(false);
    expect(first.data.report.file).toBe("reports/2026-10-14-daily_briefing.md");
    expect(readFileSync(`${ctx.paths.reports}/2026-10-14-daily_briefing.md`, "utf8")).toBe(
      "# Briefing\n\nHello\n",
    );

    const second = await call(ctx, "save_report", {
      type: "daily_briefing",
      title: "Briefing v2",
      markdown: "# Mine\nUpdated",
    });
    expect(second.data.replaced_existing).toBe(true);
    await call(ctx, "save_report", { type: "content_plan", title: "Plan", markdown: "Plan body" });

    const list = await call(ctx, "list_reports", {});
    expect(list.data.reports).toHaveLength(2);
    const latest = await call(ctx, "get_report", { type: "daily_briefing" });
    expect(latest.data.markdown).toContain("Updated");
    expect(latest.data.report.title).toBe("Briefing v2");
    const byId = await call(ctx, "get_report", {
      id: list.data.reports.find((r: { type: string }) => r.type === "content_plan").id,
    });
    expect(byId.data.markdown).toContain("Plan body");
  });

  it("rejects bad report types and missing reports", async () => {
    const ctx = createTestContext();
    expect(
      (await call(ctx, "save_report", { type: "../etc", title: "x", markdown: "y" })).data.type,
    ).toBe("ValidationError");
    const missing = await call(ctx, "get_report", { type: "daily_briefing" });
    expect(missing.isError).toBe(true);
    expect(missing.data.type).toBe("NotFoundError");
  });
});

describe("business profile", () => {
  it("returns ConfigMissingError with a hint when no profile exists", async () => {
    const ctx = createTestContext();
    const r = await call(ctx, "get_business_profile");
    expect(r.isError).toBe(true);
    expect(r.data.hint).toContain("business.example.yaml");
  });

  it("creates a new profile from a patch and validates required fields", async () => {
    const ctx = createTestContext();
    const bad = await call(ctx, "update_business_profile", { business: { name: "X" } });
    expect(bad.isError).toBe(true);
    expect(bad.data.type).toBe("ConfigInvalidError");
    const ok = await call(ctx, "update_business_profile", {
      business: {
        name: "Glow BD",
        sector: "skincare",
        country: "BD",
        currency: "BDT",
        language: "bn",
      },
      goals: { primary_kpi: "purchases", targets: { max_cpa: 350 } },
      competitors: [{ name: "Rival", website: "https://rival.example" }],
    });
    expect(ok.isError).toBe(false);
    expect(ok.data.profile.goals.targets.max_cpa).toBe(350);
    expect(ok.data.competitors_synced.active).toBe(1);
    expect(ctx.repos.competitors.list().map((c) => c.name)).toEqual(["Rival"]);
    expect(ctx.repos.competitors.getSelf()?.name).toBe("Glow BD");
  });

  it("merges into an existing file, keeps comments, null deletes, arrays replace", async () => {
    const ctx = createTestContext({ business: "example" });
    const r = await call(ctx, "update_business_profile", {
      business: { brand_voice: "playful" },
      goals: { targets: { max_cpa: 380, min_ctr_pct: null } },
      competitors: [{ name: "Competitor B", website: "https://competitor-b.com" }],
    });
    expect(r.isError).toBe(false);
    const yaml = readFileSync(ctx.business.path, "utf8");
    expect(yaml).toContain("# used to frame market research");
    expect(yaml).toContain("brand_voice: playful");
    expect(yaml).not.toContain("min_ctr_pct");
    expect(r.data.profile.goals.targets).toEqual({ max_cpa: 380, min_roas: 2.5 });
    expect(r.data.profile.business.name).toBe("My Brand");
    expect(r.data.profile.competitors).toHaveLength(1);
    expect(r.data.competitors_synced.deactivated).toEqual(["Competitor A"]);
  });
});
