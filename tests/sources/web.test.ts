import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../src/analytics/snapshotDiff.js";
import { extractPage } from "../../src/sources/web/extractor.js";
import { PoliteFetcher } from "../../src/sources/web/fetcher.js";
import { isPathAllowed, parseRobots } from "../../src/sources/web/robots.js";
import { FetchBlockedError } from "../../src/utils/errors.js";

const page = (n: string) =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", "web", n), "utf8");

describe("robots.txt", () => {
  const txt = `
User-agent: *
Disallow: /checkout
Disallow: /*.pdf$
Allow: /checkout/help

User-agent: AIMarketingManagerBot
User-agent: OtherBot
Disallow: /private
`;
  it("uses the most specific group and longest match", () => {
    const generic = parseRobots(txt, "SomeBot");
    expect(isPathAllowed(generic, "/")).toBe(true);
    expect(isPathAllowed(generic, "/checkout/pay")).toBe(false);
    expect(isPathAllowed(generic, "/checkout/help/faq")).toBe(true);
    expect(isPathAllowed(generic, "/files/a.pdf")).toBe(false);
    expect(isPathAllowed(generic, "/files/a.pdf?x=1")).toBe(true);
    const ours = parseRobots(txt, "AIMarketingManagerBot");
    expect(isPathAllowed(ours, "/checkout/pay")).toBe(true);
    expect(isPathAllowed(ours, "/private/x")).toBe(false);
  });
  it("Disallow: / blocks everything; empty Disallow allows", () => {
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow: /", "x"), "/a")).toBe(false);
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow:", "x"), "/a")).toBe(true);
  });
});

describe("extractPage", () => {
  const p = extractPage(page("competitor-a-v1.html"));
  it("extracts title, meta, headings and CTAs (ignoring scripts)", () => {
    expect(p.title).toBe("GlowLab — Vitamin C Serum Bangladesh");
    expect(p.meta_description).toContain("Cash on delivery");
    expect(p.headings.map((h) => `${h.level}:${h.text}`)).toEqual([
      "1:Bright skin in 28 days",
      "2:Why 15% Vitamin C?",
      "3:Loved by 10k+ happy customers",
    ]);
    expect(p.ctas).toEqual(expect.arrayContaining(["Shop Now", "Add to Cart", "Contact us"]));
    expect(p.text).not.toContain("9,999");
  });
  it("detects prices with currency and context", () => {
    const values = p.prices.map((x) => `${x.currency}:${x.value}`);
    expect(values).toEqual(expect.arrayContaining(["BDT:1450", "BDT:950"]));
    expect(p.prices.find((x) => x.value === 1450)!.context).toContain("Vitamin C Serum");
  });
  it("detects offers and social proof", () => {
    const offers = p.offers.join(" | ").toLowerCase();
    expect(offers).toContain("20% off");
    expect(offers).toContain("free home delivery");
    expect(offers).toContain("cash on delivery");
    const proof = p.social_proof.map((s) => `${s.kind}:${s.value}`);
    expect(proof).toEqual(
      expect.arrayContaining(["rating:4.8", "reviews:2300", "customers:10000"]),
    );
    expect(p.social_proof.some((s) => s.kind === "testimonial")).toBe(true);
  });
});

describe("diffSnapshots", () => {
  it("reports added/removed offers, prices and headings between two versions", () => {
    const mk = (html: string, at: string, hash: string) => ({
      ...extractPage(html),
      url: "https://a.test/",
      fetched_at: at,
      content_hash: hash,
    });
    const d = diffSnapshots(
      mk(page("competitor-a-v1.html"), "2026-10-01T09:00:00Z", "h1"),
      mk(page("competitor-a-v2.html"), "2026-10-08T09:00:00Z", "h2"),
    );
    expect(d.has_changes).toBe(true);
    expect(d.content_changed).toBe(true);
    expect(d.title).toBeUndefined();
    expect(d.headings.added).toEqual(["New: Niacinamide Serum", "Loved by 12k+ happy customers"]);
    expect(d.headings.removed).toEqual(["Loved by 10k+ happy customers"]);
    expect(d.prices.added.map((p) => p.value)).toEqual([1290]);
    expect(d.prices.removed.map((p) => p.value)).toEqual([1450]);
    expect(d.offers.added.join(" ").toLowerCase()).toContain("buy 2 get 1 free");
    expect(d.offers.removed.join(" ").toLowerCase()).toContain("20% off");
    expect(d.offers.added.join(" ").toLowerCase()).not.toContain("cash on delivery");
  });
  it("no changes for identical snapshots", () => {
    const s = {
      ...extractPage(page("mybrand.html")),
      url: "u",
      fetched_at: "t",
      content_hash: "h",
    };
    expect(diffSnapshots(s, { ...s, fetched_at: "t2" }).has_changes).toBe(false);
  });
});

describe("PoliteFetcher", () => {
  const html = (body: string, status = 200, type = "text/html") =>
    new Response(body, { status, headers: { "content-type": type } });

  it("obeys robots.txt and identifies itself", async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const f = new PoliteFetcher({
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, ua: new Headers(init?.headers).get("user-agent") });
        if (url.endsWith("/robots.txt"))
          return html("User-agent: *\nDisallow: /secret", 200, "text/plain");
        return html("<title>ok</title>");
      }) as typeof fetch,
      sleep: async () => {},
      userAgent: "AIMarketingManagerBot/1.0 (+https://example.com)",
      timeoutMs: 1000,
    });
    await expect(f.fetchPage("https://site.test/secret/page")).rejects.toBeInstanceOf(
      FetchBlockedError,
    );
    const ok = await f.fetchPage("https://site.test/");
    expect(ok.html).toContain("ok");
    expect(seen.filter((s) => s.url.endsWith("robots.txt"))).toHaveLength(1);
    expect(seen.every((s) => s.ua?.startsWith("AIMarketingManagerBot/1.0"))).toBe(true);
  });

  it("waits at least 1s between requests to the same host", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const f = new PoliteFetcher({
      fetch: (async (url: string) =>
        url.endsWith("robots.txt") ? html("", 404) : html("<p>x</p>")) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      clock: () => now,
      userAgent: "Bot",
      timeoutMs: 1000,
    });
    await f.fetchPage("https://a.test/1");
    await f.fetchPage("https://a.test/2");
    await f.fetchPage("https://b.test/1");
    // robots.txt counts as a request: a.test robots→page1 (wait), page1→page2 (wait); b.test robots→page (wait).
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it("caps the body size and rejects non-HTML and server errors on robots", async () => {
    const big = "<p>" + "a".repeat(5000) + "</p>";
    const f = new PoliteFetcher({
      fetch: (async (url: string) => {
        if (url.endsWith("robots.txt")) return html("", 404);
        if (url.includes("pdf")) return html("x", 200, "application/pdf");
        return html(big);
      }) as typeof fetch,
      sleep: async () => {},
      userAgent: "Bot",
      timeoutMs: 1000,
      maxBytes: 1000,
    });
    const r = await f.fetchPage("https://a.test/");
    expect(r.truncated).toBe(true);
    expect(r.html.length).toBe(1000);
    await expect(f.fetchPage("https://a.test/file.pdf")).rejects.toThrow(/not an HTML page/);
    const blocked = new PoliteFetcher({
      fetch: (async () => html("", 503)) as typeof fetch,
      sleep: async () => {},
      userAgent: "Bot",
      timeoutMs: 1000,
    });
    await expect(blocked.fetchPage("https://c.test/")).rejects.toThrow(/robots/);
  });
});
