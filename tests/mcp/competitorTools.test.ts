import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computePositioning } from "../../src/analytics/positioning.js";
import { positioningWeightsSchema } from "../../src/config/business.js";
import { createTestContext, importSample } from "../helpers/context.js";
import { call } from "./performanceTools.test.js";

const page = (n: string) =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", "web", n), "utf8");

/** Serves competitor-a v1 until `version.v` is bumped, plus my own site; competitor-b is down. */
function fakeWeb(version: { v: number }) {
  return (async (url: string) => {
    const u = new URL(url);
    const html = (b: string, s = 200) =>
      new Response(b, { status: s, headers: { "content-type": "text/html; charset=utf-8" } });
    if (u.pathname === "/robots.txt") return html("", 404);
    if (u.host === "competitor-a.com")
      return html(page(version.v === 1 ? "competitor-a-v1.html" : "competitor-a-v2.html"));
    if (u.host === "mybrand.com") return html(page("mybrand.html"));
    return html("down", 503);
  }) as typeof fetch;
}

describe("competitor tools", () => {
  it("snapshots twice and reports the right diff; one failing site doesn't stop the rest", async () => {
    const version = { v: 1 };
    const ctx = createTestContext({ business: "example", fetch: fakeWeb(version) });
    const first = await call(ctx, "snapshot_competitor_websites", {});
    expect(first.isError).toBe(false);
    const status = Object.fromEntries(
      first.data.results.map((r: { brand: string; status: string }) => [r.brand, r.status]),
    );
    expect(status).toEqual({
      "My Brand": "first_snapshot",
      "Competitor A": "first_snapshot",
      "Competitor B": "failed",
    });

    version.v = 2;
    const second = await call(ctx, "snapshot_competitor_websites", { names: ["Competitor A"] });
    expect(second.data.results[0].status).toBe("changed");
    expect(second.data.results[0].changes.prices.added[0]).toContain("1290");

    const changes = await call(ctx, "get_competitor_website_changes", { name: "Competitor A" });
    const c = changes.data.brands[0].changes[0];
    expect(c.offers.added.join(" ").toLowerCase()).toContain("buy 2 get 1 free");
    expect(c.offers.removed.join(" ").toLowerCase()).toContain("20% off");
    expect(c.headings.added).toContain("New: Niacinamide Serum");

    const third = await call(ctx, "snapshot_competitor_websites", { names: ["Competitor A"] });
    expect(third.data.results[0].status).toBe("unchanged");
  });

  it("adds/removes competitors in business.yaml and resolves 'self'", async () => {
    const ctx = createTestContext({ business: "example" });
    const add = await call(ctx, "add_competitor", {
      name: "Glow Co",
      website: "https://glow.example",
      facebook_page_id: "12345",
    });
    expect(add.isError).toBe(false);
    expect(readFileSync(ctx.business.path, "utf8")).toContain("Glow Co");
    const dup = await call(ctx, "add_competitor", { name: "glow co" });
    expect(dup.isError).toBe(true);
    const link = await call(ctx, "get_ad_library_link", { name: "Glow Co" });
    expect(link.data.url).toContain("view_all_page_id=12345");
    expect(link.data.url).toContain("country=BD");
    const list = await call(ctx, "list_competitors");
    expect(list.data.competitors.map((c: { name: string }) => c.name)).toEqual([
      "Competitor A",
      "Competitor B",
      "Glow Co",
    ]);
    await call(ctx, "remove_competitor", { name: "Competitor B" });
    expect((await call(ctx, "list_competitors")).data.competitors).toHaveLength(2);
    const sig = await call(ctx, "record_competitor_signal", {
      name: "self",
      signal: "social_followers",
      value: 25000,
    });
    expect(sig.data.brand).toBe("My Brand");
    const unknown = await call(ctx, "get_competitor_profile", { name: "Nobody" });
    expect(unknown.isError).toBe(true);
    expect(unknown.data.hint).toContain("Competitor A");
  });

  it("imports manual competitor ads idempotently and flags proven ads", async () => {
    const ctx = createTestContext({ business: "example" });
    writeFileSync(
      join(ctx.paths.competitors, "competitor-a.csv"),
      [
        "date_seen,headline,body,cta,format,landing_url,start_date,is_active",
        "2026-10-12,Glow in 28 days,Dermatologist-made serum,SHOP_NOW,video,https://competitor-a.com,2026-08-20,yes",
        "2026-10-12,20% OFF this week,Limited offer,SHOP_NOW,image,https://competitor-a.com/sale,2026-10-05,yes",
        "2026-10-12,Old summer ad,Summer glow,LEARN_MORE,image,,2026-06-01,no",
        ",,,,,,,",
      ].join("\n"),
    );
    writeFileSync(join(ctx.paths.competitors, "unknown-brand.csv"), "headline\nx\n");
    const r = await call(ctx, "import_competitor_ads");
    expect(r.data.results.find((x: { file: string }) => x.file === "competitor-a.csv").ads).toBe(3);
    expect(
      r.data.results.find((x: { file: string }) => x.file === "unknown-brand.csv").status,
    ).toBe("skipped");
    await call(ctx, "import_competitor_ads");
    const all = await call(ctx, "get_competitor_ads", { name: "Competitor A" });
    expect(all.data.ads).toHaveLength(3);
    const proven = await call(ctx, "get_competitor_ads", { proven_only: true, active_only: true });
    expect(proven.data.ads.map((a: { headline: string }) => a.headline)).toEqual([
      "Glow in 28 days",
    ]);
    expect(proven.data.ads[0].days_running).toBe(55);
  });

  it("explains Ad Library limits for non-EU countries", async () => {
    const ctx = createTestContext({ business: "example" });
    const noToken = await call(ctx, "fetch_competitor_ads", {});
    expect(noToken.data.supported).toBe(false);
    expect(noToken.data.limitation).toContain("EU");
    expect(noToken.data.links).toHaveLength(2);

    const ctx2 = createTestContext({
      business: "example",
      env: { META_ACCESS_TOKEN: "tok" },
      fetch: (async () =>
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    const empty = await call(ctx2, "fetch_competitor_ads", { name: "Competitor A" });
    expect(empty.data.supported).toBe("limited");
    expect(empty.data.results[0].note).toContain("only returns commercial ads delivered in the EU");

    const ctx3 = createTestContext({
      business: "example",
      env: { META_ACCESS_TOKEN: "tok" },
      fetch: (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "111",
                ad_delivery_start_time: "2026-08-01",
                ad_creative_bodies: ["Body"],
                ad_creative_link_titles: ["Title"],
                publisher_platforms: ["facebook", "instagram"],
              },
              {
                id: "112",
                ad_delivery_start_time: "2026-09-01",
                ad_delivery_stop_time: "2026-09-10",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    const eu = await call(ctx3, "fetch_competitor_ads", { name: "Competitor A", country: "DE" });
    expect(eu.data.supported).toBe(true);
    expect(eu.data.results[0]).toMatchObject({ ads_returned: 2, active: 1 });
  });

  it("returns positioning scores with coverage %, and a profile", async () => {
    const ctx = createTestContext({ business: "example", fetch: fakeWeb({ v: 1 }) });
    await importSample(ctx);
    await call(ctx, "snapshot_competitor_websites", {});
    writeFileSync(
      join(ctx.paths.competitors, "competitor-a.csv"),
      "headline,body,start_date,is_active\nA,a,2026-08-01,yes\nB,b,2026-10-01,yes\nC,c,2026-09-20,yes\n",
    );
    await call(ctx, "import_competitor_ads");
    await call(ctx, "record_competitor_signal", {
      name: "Competitor A",
      signal: "social_followers",
      value: 120000,
    });
    await call(ctx, "record_competitor_signal", {
      name: "self",
      signal: "social_followers",
      value: 15000,
    });

    const r = await call(ctx, "get_competitive_positioning");
    expect(r.isError).toBe(false);
    expect(r.data.disclaimer).toMatch(/ESTIMATE/);
    const by = Object.fromEntries(r.data.ranking.map((x: { name: string }) => [x.name, x]));
    expect(by["My Brand"].signals.active_ad_count.raw).toBe(12);
    expect(by["Competitor A"].signals.active_ad_count.raw).toBe(3);
    expect(by["My Brand"].signals.active_ad_count.score).toBe(100);
    expect(by["Competitor A"].signals.price_position.raw).toBeCloseTo(1.0, 1); // median(1450, 950) / 1200
    expect(by["Competitor A"].signals.social_following.score).toBe(100);
    expect(by["Competitor B"].presence_score).toBeNull();
    expect(by["Competitor B"].coverage_pct).toBe(0);
    expect(by["Competitor B"].rank).toBeNull();
    expect(by["My Brand"].coverage_pct).toBeGreaterThan(50);
    expect(by["My Brand"].signals.web_traffic.raw).toBeNull();
    expect(
      r.data.data_gaps.find((g: { signal: string }) => g.signal === "web_traffic").how_to_fill,
    ).toContain("record_competitor_signal");

    const profile = await call(ctx, "get_competitor_profile", { name: "Competitor A" });
    expect(profile.data.website[0].offers.length).toBeGreaterThan(0);
    expect(profile.data.ads.proven).toBe(1);
    expect(profile.data.presence.name).toBe("Competitor A");
  });
});

describe("computePositioning", () => {
  const w = positioningWeightsSchema.parse({});
  it("scales relative to the best brand and handles missing data", () => {
    const r = computePositioning(
      [
        { name: "A", is_self: true, raw: { active_ad_count: 10, price_position: 1 } },
        { name: "B", is_self: false, raw: { active_ad_count: 0, price_position: 0.8 } },
        { name: "C", is_self: false, raw: {} },
      ],
      w,
    );
    const a = r.find((x) => x.name === "A")!;
    const b = r.find((x) => x.name === "B")!;
    expect(a.signals.active_ad_count.score).toBe(100);
    expect(b.signals.active_ad_count.score).toBe(0);
    expect(b.signals.price_position.score).toBe(100);
    expect(a.signals.price_position.score).toBe(80);
    expect(a.coverage_pct).toBeCloseTo((1.5 / 7.5) * 100, 1);
    expect(a.confidence).toBe("low");
    expect(r[r.length - 1]!.name).toBe("C");
    expect(r[r.length - 1]!.presence_score).toBeNull();
  });
});
