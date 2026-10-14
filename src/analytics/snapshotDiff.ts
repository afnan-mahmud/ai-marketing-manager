import type { DetectedPrice, SocialProof, WebsiteSnapshot } from "../types/competitor.js";

export interface ListDiff<T> {
  added: T[];
  removed: T[];
}

export interface SnapshotDiff {
  url: string;
  from: string;
  to: string;
  has_changes: boolean;
  content_changed: boolean;
  title?: { before: string | null; after: string | null };
  meta_description?: { before: string | null; after: string | null };
  headings: ListDiff<string>;
  offers: ListDiff<string>;
  prices: ListDiff<DetectedPrice>;
  ctas: ListDiff<string>;
  social_proof: ListDiff<SocialProof>;
}

type SnapshotLike = Pick<
  WebsiteSnapshot,
  | "url"
  | "fetched_at"
  | "content_hash"
  | "title"
  | "meta_description"
  | "headings"
  | "offers"
  | "prices"
  | "ctas"
  | "social_proof"
>;

function listDiff<T>(before: T[], after: T[], key: (t: T) => string): ListDiff<T> {
  const b = new Map(before.map((x) => [key(x), x]));
  const a = new Map(after.map((x) => [key(x), x]));
  return {
    added: [...a.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v),
    removed: [...b.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** What changed between two snapshots of the same URL (pure). */
export function diffSnapshots(prev: SnapshotLike, cur: SnapshotLike): SnapshotDiff {
  const d: SnapshotDiff = {
    url: cur.url,
    from: prev.fetched_at,
    to: cur.fetched_at,
    has_changes: false,
    content_changed: prev.content_hash !== cur.content_hash,
    headings: listDiff(
      prev.headings.map((h) => h.text),
      cur.headings.map((h) => h.text),
      norm,
    ),
    offers: listDiff(prev.offers, cur.offers, norm),
    prices: listDiff(prev.prices, cur.prices, (p) => `${p.currency ?? ""}|${p.value}`),
    ctas: listDiff(prev.ctas, cur.ctas, norm),
    social_proof: listDiff(
      prev.social_proof,
      cur.social_proof,
      (s) => `${s.kind}|${s.value ?? norm(s.text)}`,
    ),
  };
  if ((prev.title ?? "") !== (cur.title ?? "")) d.title = { before: prev.title, after: cur.title };
  if ((prev.meta_description ?? "") !== (cur.meta_description ?? "")) {
    d.meta_description = { before: prev.meta_description, after: cur.meta_description };
  }
  d.has_changes =
    Boolean(d.title || d.meta_description) ||
    [d.headings, d.offers, d.prices, d.ctas, d.social_proof].some(
      (l) => l.added.length > 0 || l.removed.length > 0,
    );
  return d;
}
