import type { DB } from "../client.js";
import type {
  Competitor,
  CompetitorAd,
  CompetitorSignal,
  ExtractedPage,
  WebsiteSnapshot,
} from "../../types/competitor.js";

interface CompetitorRow {
  id: number;
  name: string;
  website: string | null;
  facebook_page_id: string | null;
  notes: string | null;
  active: number;
  is_self: number;
}

interface SnapshotRow {
  id: number;
  competitor_id: number;
  url: string;
  fetched_at: string;
  content_hash: string;
  title: string | null;
  meta_description: string | null;
  headings_json: string;
  prices_json: string;
  offers_json: string;
  ctas_json: string;
  social_proof_json: string;
  raw_text_path: string | null;
}

interface AdRow extends Omit<CompetitorAd, "is_active"> {
  is_active: number;
}

const toCompetitor = (r: CompetitorRow): Competitor => ({
  ...r,
  active: r.active === 1,
  is_self: r.is_self === 1,
});

const toSnapshot = (r: SnapshotRow): WebsiteSnapshot => ({
  id: r.id,
  competitor_id: r.competitor_id,
  url: r.url,
  fetched_at: r.fetched_at,
  content_hash: r.content_hash,
  title: r.title,
  meta_description: r.meta_description,
  headings: JSON.parse(r.headings_json || "[]"),
  prices: JSON.parse(r.prices_json || "[]"),
  offers: JSON.parse(r.offers_json || "[]"),
  ctas: JSON.parse(r.ctas_json || "[]"),
  social_proof: JSON.parse(r.social_proof_json || "[]"),
  raw_text_path: r.raw_text_path,
});

const toAd = (r: AdRow): CompetitorAd => ({ ...r, is_active: r.is_active === 1 });

export class CompetitorRepo {
  constructor(private readonly db: DB) {}

  /** Insert or update by name; re-activates soft-deleted competitors. */
  upsert(c: {
    name: string;
    website?: string | null;
    facebook_page_id?: string | null;
    notes?: string | null;
    is_self?: boolean;
  }): Competitor {
    this.db
      .prepare(
        `INSERT INTO competitors (name, website, facebook_page_id, notes, active, is_self)
         VALUES (@name, @website, @facebook_page_id, @notes, 1, @is_self)
         ON CONFLICT(name) DO UPDATE SET website = excluded.website,
           facebook_page_id = excluded.facebook_page_id, notes = excluded.notes,
           active = 1, is_self = excluded.is_self`,
      )
      .run({
        name: c.name,
        website: c.website || null,
        facebook_page_id: c.facebook_page_id || null,
        notes: c.notes ?? null,
        is_self: c.is_self ? 1 : 0,
      });
    return this.getByName(c.name)!;
  }

  setActive(name: string, active: boolean): void {
    this.db.prepare("UPDATE competitors SET active = ? WHERE name = ?").run(active ? 1 : 0, name);
  }

  /** Deactivate every non-self competitor not in `names`. */
  deactivateExcept(names: string[]): void {
    const all = this.list({ includeInactive: true }).filter((c) => !c.is_self);
    for (const c of all) if (!names.includes(c.name) && c.active) this.setActive(c.name, false);
  }

  /** Only one row may be the user's own brand. */
  clearSelfExcept(name: string): void {
    this.db
      .prepare("UPDATE competitors SET is_self = 0, active = 0 WHERE is_self = 1 AND name != ?")
      .run(name);
  }

  getByName(name: string): Competitor | null {
    const r = this.db
      .prepare("SELECT * FROM competitors WHERE name = ? COLLATE NOCASE")
      .get(name) as CompetitorRow | undefined;
    return r ? toCompetitor(r) : null;
  }

  getById(id: number): Competitor | null {
    const r = this.db.prepare("SELECT * FROM competitors WHERE id = ?").get(id) as
      CompetitorRow | undefined;
    return r ? toCompetitor(r) : null;
  }

  getSelf(): Competitor | null {
    const r = this.db
      .prepare("SELECT * FROM competitors WHERE is_self = 1 AND active = 1")
      .get() as CompetitorRow | undefined;
    return r ? toCompetitor(r) : null;
  }

  list(opts: { includeInactive?: boolean; includeSelf?: boolean } = {}): Competitor[] {
    const rows = this.db
      .prepare("SELECT * FROM competitors ORDER BY name")
      .all() as CompetitorRow[];
    return rows
      .map(toCompetitor)
      .filter((c) => (opts.includeInactive || c.active) && (opts.includeSelf || !c.is_self));
  }

  // --- website snapshots ---

  insertSnapshot(s: {
    competitor_id: number;
    url: string;
    fetched_at: string;
    content_hash: string;
    page: ExtractedPage;
    raw_text_path: string | null;
  }): WebsiteSnapshot {
    const info = this.db
      .prepare(
        `INSERT INTO website_snapshots (competitor_id, url, fetched_at, content_hash, title, meta_description,
           headings_json, prices_json, offers_json, ctas_json, social_proof_json, raw_text_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.competitor_id,
        s.url,
        s.fetched_at,
        s.content_hash,
        s.page.title,
        s.page.meta_description,
        JSON.stringify(s.page.headings),
        JSON.stringify(s.page.prices),
        JSON.stringify(s.page.offers),
        JSON.stringify(s.page.ctas),
        JSON.stringify(s.page.social_proof),
        s.raw_text_path,
      );
    return this.getSnapshot(Number(info.lastInsertRowid))!;
  }

  getSnapshot(id: number): WebsiteSnapshot | null {
    const r = this.db.prepare("SELECT * FROM website_snapshots WHERE id = ?").get(id) as
      SnapshotRow | undefined;
    return r ? toSnapshot(r) : null;
  }

  latestSnapshot(competitorId: number, url?: string): WebsiteSnapshot | null {
    const r = (
      url
        ? this.db
            .prepare(
              "SELECT * FROM website_snapshots WHERE competitor_id = ? AND url = ? ORDER BY fetched_at DESC, id DESC LIMIT 1",
            )
            .get(competitorId, url)
        : this.db
            .prepare(
              "SELECT * FROM website_snapshots WHERE competitor_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1",
            )
            .get(competitorId)
    ) as SnapshotRow | undefined;
    return r ? toSnapshot(r) : null;
  }

  /** Latest snapshot per URL for a competitor. */
  latestSnapshotsPerUrl(competitorId: number): WebsiteSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM website_snapshots s
         JOIN (SELECT url, MAX(id) AS max_id FROM website_snapshots WHERE competitor_id = ? GROUP BY url) m
           ON s.id = m.max_id
         ORDER BY s.url`,
      )
      .all(competitorId) as SnapshotRow[];
    return rows.map(toSnapshot);
  }

  listSnapshots(competitorId: number): WebsiteSnapshot[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM website_snapshots WHERE competitor_id = ? ORDER BY url, fetched_at, id",
      )
      .all(competitorId) as SnapshotRow[];
    return rows.map(toSnapshot);
  }

  // --- competitor ads ---

  /** Upsert on (competitor_id, external_id), widening the first_seen/last_seen window. */
  upsertAds(ads: CompetitorAd[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO competitor_ads (competitor_id, external_id, first_seen, last_seen, start_date, is_active,
         body, headline, cta, format, landing_url, platforms, source)
       VALUES (@competitor_id, @external_id, @first_seen, @last_seen, @start_date, @is_active,
         @body, @headline, @cta, @format, @landing_url, @platforms, @source)
       ON CONFLICT(competitor_id, external_id) DO UPDATE SET
         first_seen = MIN(COALESCE(competitor_ads.first_seen, excluded.first_seen), COALESCE(excluded.first_seen, competitor_ads.first_seen)),
         last_seen = MAX(COALESCE(competitor_ads.last_seen, excluded.last_seen), COALESCE(excluded.last_seen, competitor_ads.last_seen)),
         start_date = COALESCE(excluded.start_date, competitor_ads.start_date),
         is_active = excluded.is_active,
         body = COALESCE(excluded.body, competitor_ads.body),
         headline = COALESCE(excluded.headline, competitor_ads.headline),
         cta = COALESCE(excluded.cta, competitor_ads.cta),
         format = COALESCE(excluded.format, competitor_ads.format),
         landing_url = COALESCE(excluded.landing_url, competitor_ads.landing_url),
         platforms = COALESCE(excluded.platforms, competitor_ads.platforms)`,
    );
    const run = this.db.transaction((items: CompetitorAd[]) => {
      let n = 0;
      for (const a of items) n += stmt.run({ ...a, is_active: a.is_active ? 1 : 0 }).changes;
      return n;
    });
    return run(ads);
  }

  listAds(competitorId?: number): CompetitorAd[] {
    const rows = (
      competitorId === undefined
        ? this.db
            .prepare("SELECT * FROM competitor_ads ORDER BY competitor_id, start_date DESC")
            .all()
        : this.db
            .prepare(
              "SELECT * FROM competitor_ads WHERE competitor_id = ? ORDER BY start_date DESC",
            )
            .all(competitorId)
    ) as AdRow[];
    return rows.map(toAd);
  }

  // --- signals ---

  upsertSignal(s: CompetitorSignal): void {
    this.db
      .prepare(
        `INSERT INTO competitor_signals (competitor_id, date, signal, value, note) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(competitor_id, date, signal) DO UPDATE SET value = excluded.value, note = excluded.note`,
      )
      .run(s.competitor_id, s.date, s.signal, s.value, s.note);
  }

  listSignals(competitorId: number): CompetitorSignal[] {
    return this.db
      .prepare(
        "SELECT * FROM competitor_signals WHERE competitor_id = ? ORDER BY date DESC, signal",
      )
      .all(competitorId) as CompetitorSignal[];
  }

  /** Latest value per signal name. */
  latestSignals(competitorId: number): Record<string, CompetitorSignal> {
    const out: Record<string, CompetitorSignal> = {};
    for (const s of this.listSignals(competitorId)) if (!out[s.signal]) out[s.signal] = s;
    return out;
  }
}
