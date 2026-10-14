import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { format } from "date-fns";
import Papa from "papaparse";
import { diffSnapshots, type SnapshotDiff } from "../analytics/snapshotDiff.js";
import type { BusinessConfig, CompetitorConfig } from "../config/business.js";
import type { AppContext } from "../context.js";
import {
  AD_LIBRARY_LIMITATION,
  adLibraryUrl,
  EU_COUNTRIES,
  mapArchivedAd,
  searchAdLibrary,
} from "../sources/adLibrary/client.js";
import { MetaApiClient } from "../sources/metaApi/client.js";
import { parseDate } from "../sources/metaExport/parser.js";
import { extractPage } from "../sources/web/extractor.js";
import { PoliteFetcher } from "../sources/web/fetcher.js";
import type { Competitor, CompetitorAd, WebsiteSnapshot } from "../types/competitor.js";
import { daysBetween, shiftDate } from "../utils/dates.js";
import { AppError, MetaApiError, NotFoundError } from "../utils/errors.js";
import { slugify } from "../utils/slug.js";

/** A competitor ad running at least this many days is "proven" (likely profitable). */
export const PROVEN_AD_DAYS = 30;
const SELF_ALIASES = new Set(["self", "me", "my brand", "mine", "own", "us"]);

export interface CompetitorAdView extends CompetitorAd {
  competitor: string;
  days_running: number | null;
  proven: boolean;
}

export class CompetitorService {
  private fetcher: PoliteFetcher | null = null;

  constructor(private readonly ctx: AppContext) {}

  // ---------- list management (business.yaml is the source of truth) ----------

  /**
   * Mirrors business.yaml into the DB: upserts listed competitors (and the user's own brand as is_self),
   * soft-deactivates the rest so their history is kept.
   */
  syncFromConfig(config: BusinessConfig | null = this.ctx.business.tryLoad()) {
    if (!config) return { synced: false, active: 0, deactivated: [] as string[] };
    const repo = this.ctx.repos.competitors;
    const before = repo.list().map((c) => c.name);
    const names = config.competitors.map((c) => c.name);
    for (const c of config.competitors) {
      repo.upsert({
        name: c.name,
        website: c.website,
        facebook_page_id: c.facebook_page_id,
        notes: c.notes,
      });
    }
    repo.deactivateExcept(names);
    repo.upsert({
      name: config.business.name,
      website: config.business.website,
      notes: "Your brand",
      is_self: true,
    });
    repo.clearSelfExcept(config.business.name);
    return {
      synced: true,
      active: names.length,
      deactivated: before.filter((n) => !names.includes(n)),
    };
  }

  private config(): BusinessConfig {
    const cfg = this.ctx.business.require();
    this.syncFromConfig(cfg);
    return cfg;
  }

  /** Finds an active competitor or the user's own brand ("self"/"me" or the business name). */
  resolve(name: string): Competitor {
    const cfg = this.config();
    const repo = this.ctx.repos.competitors;
    const key = name.trim().toLowerCase();
    if (SELF_ALIASES.has(key) || key === cfg.business.name.toLowerCase()) return repo.getSelf()!;
    const c = repo.getByName(name.trim());
    if (c && c.active) return c;
    const known = repo.list().map((x) => x.name);
    throw new NotFoundError(
      `Unknown competitor "${name}".`,
      `Known competitors: ${known.join(", ") || "(none)"}. Use "self" for your own brand, or add_competitor to add one.`,
    );
  }

  private brands(names?: string[]): Competitor[] {
    this.config();
    const repo = this.ctx.repos.competitors;
    if (names && names.length) return names.map((n) => this.resolve(n));
    const self = repo.getSelf();
    return [...(self ? [self] : []), ...repo.list()];
  }

  private configFor(c: Competitor): CompetitorConfig | null {
    const cfg = this.ctx.business.require();
    if (c.is_self)
      return {
        name: cfg.business.name,
        website: cfg.business.website,
        extra_urls: cfg.business.extra_urls,
      };
    return cfg.competitors.find((x) => x.name === c.name) ?? null;
  }

  list() {
    const cfg = this.config();
    const repo = this.ctx.repos.competitors;
    const rows = repo.list().map((c) => {
      const snaps = repo.latestSnapshotsPerUrl(c.id);
      const ads = repo.listAds(c.id);
      return {
        name: c.name,
        website: c.website,
        facebook_page_id: c.facebook_page_id,
        notes: c.notes,
        extra_urls: cfg.competitors.find((x) => x.name === c.name)?.extra_urls ?? [],
        last_snapshot:
          snaps
            .map((s) => s.fetched_at)
            .sort()
            .pop() ?? null,
        ads_stored: ads.length,
        active_ads: ads.filter((a) => a.is_active).length,
      };
    });
    return {
      summary: `${rows.length} competitor(s) tracked for ${cfg.business.name}.`,
      own_brand: { name: cfg.business.name, website: cfg.business.website || null },
      competitors: rows,
    };
  }

  add(c: CompetitorConfig) {
    const cfg = this.config();
    if (cfg.competitors.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) {
      throw new AppError(
        `"${c.name}" is already a competitor.`,
        "Use update_business_profile to edit it.",
      );
    }
    const updated = this.ctx.business.update({ competitors: [...cfg.competitors, c] });
    this.syncFromConfig(updated);
    return {
      summary: `Added competitor "${c.name}" (${updated.competitors.length} tracked).`,
      competitor: c,
      next_steps: [
        "snapshot_competitor_websites to take a first website snapshot",
        `get_ad_library_link for "${c.name}" to browse their ads`,
      ],
    };
  }

  remove(name: string) {
    const cfg = this.config();
    const match = cfg.competitors.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!match)
      throw new NotFoundError(
        `"${name}" is not in the competitor list.`,
        "Use list_competitors to see names.",
      );
    const updated = this.ctx.business.update({
      competitors: cfg.competitors.filter((x) => x !== match),
    });
    this.syncFromConfig(updated);
    return {
      summary: `Removed "${match.name}" from tracking. Its history (snapshots, ads, signals) is kept in the database.`,
      remaining: updated.competitors.map((x) => x.name),
    };
  }

  // ---------- website snapshots ----------

  private getFetcher(): PoliteFetcher {
    this.fetcher ??= new PoliteFetcher({
      fetch: this.ctx.fetch,
      sleep: this.ctx.sleep,
      userAgent: this.ctx.env.WEB_USER_AGENT,
      timeoutMs: this.ctx.env.WEB_TIMEOUT_MS,
    });
    return this.fetcher;
  }

  /** Fetches, extracts, stores and diffs each brand's website pages. One failing URL never stops the rest. */
  async snapshotWebsites(names?: string[]) {
    const brands = this.brands(names);
    const fetcher = this.getFetcher();
    const repo = this.ctx.repos.competitors;
    const now = this.ctx.now();
    const fetchedAt = now.toISOString();
    const results: Record<string, unknown>[] = [];

    for (const brand of brands) {
      const cc = this.configFor(brand);
      const urls = [cc?.website, ...(cc?.extra_urls ?? [])].filter((u): u is string => Boolean(u));
      if (urls.length === 0) {
        results.push({
          brand: brand.name,
          is_self: brand.is_self,
          status: "skipped",
          reason: "No website configured.",
        });
        continue;
      }
      for (const url of urls) {
        try {
          const page = await fetcher.fetchPage(url);
          const extracted = extractPage(page.html);
          const hash = createHash("sha256")
            .update(`${extracted.title ?? ""}\n${extracted.text}`)
            .digest("hex");
          const prev = repo.latestSnapshot(brand.id, url);
          let rawPath = prev?.content_hash === hash ? prev.raw_text_path : null;
          if (!rawPath) {
            const dir = join(this.ctx.paths.snapshots, slugify(brand.name));
            mkdirSync(dir, { recursive: true });
            rawPath = join(
              dir,
              `${format(now, "yyyyMMdd-HHmmss")}-${slugify(new URL(url).pathname || "home", 40) || "home"}.txt`,
            );
            writeFileSync(
              rawPath,
              `${url}\n${fetchedAt}\n\n${extracted.title ?? ""}\n\n${extracted.text}\n`,
              "utf8",
            );
          }
          const snap = repo.insertSnapshot({
            competitor_id: brand.id,
            url,
            fetched_at: fetchedAt,
            content_hash: hash,
            page: extracted,
            raw_text_path: rawPath,
          });
          const diff = prev ? diffSnapshots(prev, snap) : null;
          results.push({
            brand: brand.name,
            is_self: brand.is_self,
            url,
            status: !prev ? "first_snapshot" : diff!.has_changes ? "changed" : "unchanged",
            title: extracted.title,
            found: {
              headings: extracted.headings.length,
              prices: extracted.prices.length,
              offers: extracted.offers.length,
              ctas: extracted.ctas.length,
              social_proof: extracted.social_proof.length,
            },
            ...(page.truncated
              ? { warning: "Page larger than 3 MB; only the first 3 MB were read." }
              : {}),
            ...(diff?.has_changes ? { changes: compactDiff(diff) } : {}),
          });
        } catch (err) {
          results.push({
            brand: brand.name,
            is_self: brand.is_self,
            url,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return {
      summary: `Snapshotted ${results.length - count("failed") - count("skipped")} page(s): ${count("changed")} changed, ${count("unchanged")} unchanged, ${count("first_snapshot")} first snapshot(s), ${count("failed")} failed.`,
      fetched_at: fetchedAt,
      note: "Public pages only; robots.txt respected; no JavaScript rendering (content loaded by scripts is not seen).",
      results,
    };
  }

  websiteChanges(opts: { name?: string; since?: string }) {
    const since = opts.since ?? shiftDate(this.ctx.today(), -7);
    const brands = this.brands(opts.name ? [opts.name] : undefined);
    const repo = this.ctx.repos.competitors;
    const out = brands.map((b) => {
      const snaps = repo.listSnapshots(b.id);
      const byUrl = new Map<string, WebsiteSnapshot[]>();
      for (const s of snaps) byUrl.set(s.url, [...(byUrl.get(s.url) ?? []), s]);
      const changes: ReturnType<typeof compactDiff>[] = [];
      for (const list of byUrl.values()) {
        for (let i = 1; i < list.length; i++) {
          if (list[i]!.fetched_at < since) continue;
          const d = diffSnapshots(list[i - 1]!, list[i]!);
          if (d.has_changes) changes.push(compactDiff(d));
        }
      }
      return {
        brand: b.name,
        is_self: b.is_self,
        snapshots: snaps.length,
        last_snapshot:
          snaps
            .map((s) => s.fetched_at)
            .sort()
            .pop() ?? null,
        changes,
        ...(snaps.length < 2
          ? {
              note: "Need at least two snapshots to detect changes — run snapshot_competitor_websites again later.",
            }
          : {}),
      };
    });
    const total = out.reduce((s, b) => s + b.changes.length, 0);
    return {
      summary: `${total} website change(s) since ${since} across ${out.filter((b) => b.changes.length).length} brand(s).`,
      since,
      brands: out,
    };
  }

  // ---------- competitor ads ----------

  private adView(a: CompetitorAd, name: string, today: string): CompetitorAdView {
    const start = a.start_date ?? a.first_seen;
    const end = a.is_active ? today : (a.last_seen ?? today);
    const days = start ? Math.max(0, daysBetween(start, end)) : null;
    return {
      ...a,
      competitor: name,
      days_running: days,
      proven: days !== null && days >= PROVEN_AD_DAYS,
    };
  }

  adsFor(brand: Competitor): CompetitorAdView[] {
    const today = this.ctx.today();
    return this.ctx.repos.competitors
      .listAds(brand.id)
      .map((a) => this.adView(a, brand.name, today));
  }

  getAds(opts: { name?: string; active_only?: boolean; proven_only?: boolean; limit?: number }) {
    const brands = opts.name ? [this.resolve(opts.name)] : this.brands().filter((b) => !b.is_self);
    let ads = brands.flatMap((b) => this.adsFor(b));
    const total = ads.length;
    if (opts.active_only) ads = ads.filter((a) => a.is_active);
    if (opts.proven_only) ads = ads.filter((a) => a.proven);
    ads.sort((a, b) => (b.days_running ?? -1) - (a.days_running ?? -1));
    const limit = opts.limit ?? 50;
    const byBrand = brands.map((b) => {
      const mine = this.adsFor(b);
      return {
        competitor: b.name,
        stored: mine.length,
        active: mine.filter((a) => a.is_active).length,
        proven: mine.filter((a) => a.proven).length,
      };
    });
    return {
      summary: `${ads.length} of ${total} stored competitor ad(s) match${opts.proven_only ? ` (proven = running ${PROVEN_AD_DAYS}+ days)` : ""}.`,
      by_competitor: byBrand,
      ads: ads.slice(0, limit).map(({ competitor_id: _c, id: _i, ...rest }) => rest),
      truncated: ads.length > limit,
      ...(total === 0
        ? {
            hint: `No competitor ads stored. Run fetch_competitor_ads (EU only), or save ads from the public Ad Library to data/competitors/<name>.csv and run import_competitor_ads.`,
          }
        : {}),
    };
  }

  async fetchAds(opts: { name?: string; country?: string }) {
    const cfg = this.config();
    const country = (opts.country ?? cfg.business.country).toUpperCase();
    const brands = opts.name ? [this.resolve(opts.name)] : this.brands().filter((b) => !b.is_self);
    const isEu = EU_COUNTRIES.has(country);
    const links = brands.map((b) => ({
      competitor: b.name,
      ad_library_url: adLibraryUrl({ country, pageId: b.facebook_page_id, query: b.name }),
    }));
    const token = this.ctx.env.META_AD_LIBRARY_TOKEN ?? this.ctx.env.META_ACCESS_TOKEN;
    if (!token) {
      return {
        summary:
          "Ad Library API not configured (no META_AD_LIBRARY_TOKEN / META_ACCESS_TOKEN). Use the links or manual import.",
        supported: false,
        country,
        limitation: AD_LIBRARY_LIMITATION,
        links,
      };
    }
    const client = new MetaApiClient({
      token,
      version: this.ctx.env.META_API_VERSION,
      fetch: this.ctx.fetch,
      sleep: this.ctx.sleep,
    });
    const today = this.ctx.today();
    const results = [];
    for (const b of brands) {
      try {
        const raw = await searchAdLibrary(client, {
          pageId: b.facebook_page_id,
          searchTerms: b.name,
          country,
        });
        const ads = raw.map((a) => mapArchivedAd(a, b.id, today));
        this.ctx.repos.competitors.upsertAds(ads);
        results.push({
          competitor: b.name,
          searched_by: b.facebook_page_id
            ? "page_id"
            : "name (add facebook_page_id for precise results)",
          ads_returned: ads.length,
          active: ads.filter((a) => a.is_active).length,
          ...(ads.length === 0 && !isEu
            ? { note: `No ads returned for ${country}. ${AD_LIBRARY_LIMITATION}` }
            : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          competitor: b.name,
          ads_returned: 0,
          error: msg,
          hint:
            err instanceof MetaApiError && (err.code === 10 || (err.code ?? 0) >= 200)
              ? "Ad Library API access requires identity verification (facebook.com/ID) and an app with Ad Library API access."
              : undefined,
        });
      }
    }
    const fetched = results.reduce((s, r) => s + (r.ads_returned ?? 0), 0);
    return {
      summary: `Ad Library returned ${fetched} ad(s) for ${brands.length} competitor(s) in ${country}.${!isEu ? " Note: commercial ads are only available for EU countries via the API." : ""}`,
      supported: isEu ? true : "limited",
      country,
      ...(isEu ? {} : { limitation: AD_LIBRARY_LIMITATION }),
      results,
      links,
    };
  }

  /** Loads manual competitor ad files: data/competitors/<competitor-name>.csv or .json. Idempotent. */
  importAds() {
    this.config();
    const dir = this.ctx.paths.competitors;
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(csv|json)$/i.test(f)) : [];
    const brands = this.brands().filter((b) => !b.is_self);
    const bySlug = new Map(brands.map((b) => [slugify(b.name), b]));
    const today = this.ctx.today();
    const results = [];
    for (const f of files) {
      const slug = slugify(basename(f, extname(f)));
      const brand = bySlug.get(slug);
      if (!brand) {
        results.push({
          file: f,
          status: "skipped",
          reason: `No competitor named like "${slug}". Expected one of: ${[...bySlug.keys()].join(", ")}.`,
        });
        continue;
      }
      try {
        const records = readManualAds(join(dir, f));
        const ads: CompetitorAd[] = [];
        let skipped = 0;
        for (const r of records) {
          const headline = str(r.headline);
          const body = str(r.body);
          if (!headline && !body) {
            skipped++;
            continue;
          }
          const seen = parseDate(r.date_seen) ?? today;
          const start = parseDate(r.start_date);
          ads.push({
            competitor_id: brand.id,
            external_id:
              str(r.ad_id) ??
              `m_${createHash("sha1")
                .update([headline, body, start, str(r.landing_url)].join("|"))
                .digest("hex")
                .slice(0, 16)}`,
            first_seen: seen,
            last_seen: seen,
            start_date: start,
            is_active: parseActive(r.is_active),
            body,
            headline,
            cta: str(r.cta),
            format: str(r.format)?.toLowerCase() ?? null,
            landing_url: str(r.landing_url),
            platforms: str(r.platforms),
            source: "manual",
          });
        }
        this.ctx.repos.competitors.upsertAds(ads);
        results.push({
          file: f,
          competitor: brand.name,
          status: "imported",
          ads: ads.length,
          rows_skipped: skipped,
        });
      } catch (err) {
        results.push({
          file: f,
          competitor: brand.name,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      summary: files.length
        ? `Imported ${results.reduce((s, r) => s + (("ads" in r && r.ads) || 0), 0)} ad(s) from ${results.filter((r) => r.status === "imported").length}/${files.length} file(s).`
        : "No files in data/competitors/.",
      expected_format: {
        file_name: "data/competitors/<competitor-name>.csv (or .json array), e.g. competitor-a.csv",
        columns: [
          "date_seen",
          "headline",
          "body",
          "cta",
          "format",
          "landing_url",
          "start_date",
          "is_active",
        ],
      },
      results,
    };
  }

  recordSignal(opts: {
    name: string;
    signal: string;
    value: number;
    note?: string;
    date?: string;
  }) {
    const brand = this.resolve(opts.name);
    const date = opts.date ?? this.ctx.today();
    this.ctx.repos.competitors.upsertSignal({
      competitor_id: brand.id,
      date,
      signal: opts.signal,
      value: opts.value,
      note: opts.note ?? null,
    });
    return {
      summary: `Recorded ${opts.signal} = ${opts.value} for ${brand.name} on ${date}.`,
      brand: brand.name,
      history: this.ctx.repos.competitors
        .listSignals(brand.id)
        .filter((s) => s.signal === opts.signal)
        .slice(0, 10),
    };
  }

  adLibraryLink(name: string) {
    const cfg = this.config();
    const b = this.resolve(name);
    const url = adLibraryUrl({
      country: cfg.business.country,
      pageId: b.facebook_page_id,
      query: b.name,
    });
    return {
      summary: `Public Ad Library ${b.facebook_page_id ? "page" : "keyword search"} for ${b.name} in ${cfg.business.country}.`,
      brand: b.name,
      url,
      ...(b.facebook_page_id
        ? {}
        : {
            tip: "Add facebook_page_id to this competitor in business.yaml for an exact page link.",
          }),
      how_to_save_ads: `Copy ads you see into data/competitors/${slugify(b.name)}.csv (columns: date_seen, headline, body, cta, format, landing_url, start_date, is_active), then run import_competitor_ads.`,
    };
  }

  profile(name: string) {
    const b = this.resolve(name);
    const repo = this.ctx.repos.competitors;
    const snaps = repo.latestSnapshotsPerUrl(b.id);
    const ads = this.adsFor(b);
    const positioning = this.ctx.services.positioning.compute();
    const changes = this.websiteChanges({
      name: b.is_self ? "self" : b.name,
      since: shiftDate(this.ctx.today(), -30),
    });
    return {
      summary: `${b.name}: ${snaps.length} page(s) snapshotted, ${ads.filter((a) => a.is_active).length} active / ${ads.length} stored ads, ${ads.filter((a) => a.proven).length} proven.`,
      brand: {
        name: b.name,
        website: b.website,
        facebook_page_id: b.facebook_page_id,
        notes: b.notes,
        is_self: b.is_self,
      },
      website: snaps.map((s) => ({
        url: s.url,
        fetched_at: s.fetched_at,
        title: s.title,
        meta_description: s.meta_description,
        headings: s.headings.slice(0, 15),
        offers: s.offers,
        prices: s.prices.slice(0, 15),
        ctas: s.ctas.slice(0, 15),
        social_proof: s.social_proof.slice(0, 10),
        raw_text_file: s.raw_text_path ? relative(this.ctx.paths.dataDir, s.raw_text_path) : null,
      })),
      changes_last_30d: changes.brands[0]?.changes ?? [],
      ads: {
        stored: ads.length,
        active: ads.filter((a) => a.is_active).length,
        proven: ads.filter((a) => a.proven).length,
        top_proven: ads
          .filter((a) => a.proven)
          .sort((x, y) => (y.days_running ?? 0) - (x.days_running ?? 0))
          .slice(0, 5)
          .map(({ competitor_id: _c, id: _i, ...rest }) => rest),
      },
      signals: Object.values(repo.latestSignals(b.id)),
      presence: positioning.ranking.find((p) => p.name === b.name) ?? null,
      ad_library_url: this.adLibraryLink(b.is_self ? "self" : b.name).url,
    };
  }
}

function compactDiff(d: SnapshotDiff) {
  const nonEmpty = <T>(l: { added: T[]; removed: T[] }) =>
    l.added.length || l.removed.length ? l : undefined;
  return {
    url: d.url,
    from: d.from,
    to: d.to,
    ...(d.title ? { title: d.title } : {}),
    ...(d.meta_description ? { meta_description: d.meta_description } : {}),
    ...(nonEmpty(d.offers) ? { offers: d.offers } : {}),
    ...(nonEmpty(d.prices)
      ? {
          prices: {
            added: d.prices.added.map(priceLabel),
            removed: d.prices.removed.map(priceLabel),
          },
        }
      : {}),
    ...(nonEmpty(d.headings) ? { headings: d.headings } : {}),
    ...(nonEmpty(d.ctas) ? { ctas: d.ctas } : {}),
    ...(nonEmpty(d.social_proof)
      ? {
          social_proof: {
            added: d.social_proof.added.map((s) => s.text),
            removed: d.social_proof.removed.map((s) => s.text),
          },
        }
      : {}),
  };
}

const priceLabel = (p: { value: number; currency: string | null; context: string }) =>
  `${p.currency ?? ""} ${p.value} — ${p.context}`.trim();

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

function parseActive(v: unknown): boolean {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  return ["1", "true", "yes", "y", "active", "running"].includes(s);
}

function readManualAds(file: string): Record<string, unknown>[] {
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (file.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) throw new AppError("JSON file must contain an array of ads.");
    return data as Record<string, unknown>[];
  }
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  return parsed.data;
}
