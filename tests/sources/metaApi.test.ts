import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MetaApiClient } from "../../src/sources/metaApi/client.js";
import { mapInsightRow, pickAction } from "../../src/sources/metaApi/insights.js";
import { MetaApiError } from "../../src/utils/errors.js";
import { createTestContext } from "../helpers/context.js";
import { call } from "../mcp/performanceTools.test.js";

const fx = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "meta", name), "utf8"));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** Routes Graph API URLs to fixtures and records every request. */
function fakeGraph(overrides: { failFirstInsights?: number } = {}) {
  const calls: string[] = [];
  let insightCalls = 0;
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname.endsWith("/insights")) {
      insightCalls++;
      if (overrides.failFirstInsights && insightCalls <= overrides.failFirstInsights) {
        return json(
          { error: { message: "User request limit reached", code: 17, is_transient: true } },
          400,
        );
      }
      return url.searchParams.get("after") === "abc"
        ? json(fx("insights-page2.json"))
        : json(fx("insights-page1.json"));
    }
    if (url.searchParams.get("ids")) {
      const all = fx("creatives.json");
      const out: Record<string, unknown> = {};
      for (const id of url.searchParams.get("ids")!.split(",")) out[id] = all[id];
      return json(out);
    }
    return json({ error: { message: "unknown path" } }, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const META_ENV = { META_ACCESS_TOKEN: "SECRET_TOKEN", META_AD_ACCOUNT_ID: "act_123" };

describe("insights mapping", () => {
  it("picks the first matching action type instead of summing overlapping ones", () => {
    const stats = [
      { action_type: "purchase", value: "4" },
      { action_type: "omni_purchase", value: "5" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "4" },
    ];
    expect(pickAction(stats, ["omni_purchase", "purchase"])).toBe(5);
    expect(pickAction(undefined, ["purchase"])).toBe(0);
    const row = mapInsightRow(fx("insights-page1.json").data[0]);
    expect(row).toMatchObject({
      ad_id: "9001",
      date: "2026-10-07",
      source: "api",
      link_clicks: 180,
      landing_page_views: 144,
      purchases: 4,
      purchase_value: 5000,
    });
    expect(row.video_3s_views).toBe(2700);
    expect(row.video_thruplays).toBe(675);
  });
});

describe("sync_ads_from_meta", () => {
  it("syncs paged insights + creatives into the same tables; analytics works unchanged", async () => {
    const { fetchImpl, calls } = fakeGraph();
    const ctx = createTestContext({ business: "example", env: META_ENV, fetch: fetchImpl });
    const r = await call(ctx, "sync_ads_from_meta", {});
    expect(r.isError).toBe(false);
    expect(r.data.range).toEqual({ since: "2026-10-07", until: "2026-10-13" });
    expect(r.data.rows).toBe(21);
    expect(r.data.creatives_updated).toBe(3);
    // account id normalised, paging followed, read-only GETs only
    expect(calls[0]).toContain("/v21.0/act_123/insights");
    expect(calls[0]).toContain("time_increment=1");
    expect(calls[0]).toContain("level=ad");
    expect(calls.filter((u) => u.includes("/insights"))).toHaveLength(2);

    const creative = ctx.repos.ads.getCreatives(["9001", "9003"]);
    expect(creative.get("9001")).toMatchObject({
      format: "video",
      headline: "Real results in 30 days",
      landing_url: "https://mybrand.com/serum",
    });
    expect(creative.get("9003")).toMatchObject({ format: "carousel", cta: "ORDER_NOW" });

    const wl = await call(ctx, "get_winners_and_losers", { period: "last_7d" });
    const byName = Object.fromEntries(
      Object.entries(wl.data.groups as Record<string, { name: string }[]>).flatMap(([v, items]) =>
        items.map((i) => [i.name, v]),
      ),
    );
    expect(byName).toEqual({
      "UGC Testimonial": "winner",
      "Price Drop Static": "loser",
      "Bundle Carousel": "winner",
    });
    const top = await call(ctx, "get_top_creatives", { period: "last_7d", limit: 1 });
    expect(top.data.ads[0].creative.headline).toBe("Real results in 30 days");

    // Re-sync is idempotent.
    await call(ctx, "sync_ads_from_meta", {});
    expect(ctx.repos.ads.countRows()).toBe(21);
  });

  it("retries transient rate-limit errors with backoff", async () => {
    const { fetchImpl } = fakeGraph({ failFirstInsights: 2 });
    const sleeps: number[] = [];
    const client = new MetaApiClient({
      token: "t",
      version: "v21.0",
      fetch: fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const rows = await client.getAll("act_1/insights", {});
    expect(rows).toHaveLength(21);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("maps an expired token to a friendly error without leaking the token", async () => {
    const fetchImpl = (async () =>
      json(
        {
          error: {
            message:
              "Error validating access token: Session has expired. access_token=SECRET_TOKEN",
            code: 190,
            fbtrace_id: "Ab1",
          },
        },
        400,
      )) as typeof fetch;
    const ctx = createTestContext({ env: META_ENV, fetch: fetchImpl });
    const r = await call(ctx, "sync_ads_from_meta", {});
    expect(r.isError).toBe(true);
    expect(r.data.type).toBe("MetaApiError");
    expect(r.data.error).toContain("invalid or expired");
    expect(JSON.stringify(r.data)).not.toContain("SECRET_TOKEN");
  });

  it("gives up after max retries on persistent 500s", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return json({ error: { message: "boom", code: 1 } }, 500);
    }) as typeof fetch;
    const client = new MetaApiClient({
      token: "t",
      version: "v21.0",
      fetch: fetchImpl,
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(client.get("me")).rejects.toBeInstanceOf(MetaApiError);
    expect(n).toBe(3);
  });

  it("explains when the API isn't configured", async () => {
    const ctx = createTestContext();
    const r = await call(ctx, "sync_ads_from_meta", {});
    expect(r.isError).toBe(true);
    expect(r.data.hint).toContain("META_ACCESS_TOKEN");
  });
});
