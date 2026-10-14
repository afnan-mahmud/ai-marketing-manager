import { z } from "zod";
import { isoDateSchema } from "../../utils/dates.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

const name = z
  .string()
  .min(1)
  .describe('Competitor name as in business.yaml, or "self" for your own brand.');

export const listCompetitors = defineTool({
  name: "list_competitors",
  title: "List competitors",
  description:
    "Competitors tracked in business.yaml with website, Facebook page id, last snapshot date and stored ads.",
  inputSchema: {},
  handler: (_a, ctx) => ctx.services.competitors.list(),
});

export const addCompetitor = defineTool({
  name: "add_competitor",
  title: "Add competitor",
  description:
    "Adds a competitor to business.yaml (and the database). Optional extra_urls = product/pricing pages to snapshot too.",
  inputSchema: {
    name: z.string().min(1),
    website: z.string().url().optional(),
    facebook_page_id: z.string().regex(/^\d*$/, "numeric page id").optional(),
    notes: z.string().optional(),
    extra_urls: z.array(z.string().url()).max(10).optional(),
  },
  readOnly: false,
  handler: (a, ctx) => ctx.services.competitors.add(a),
});

export const removeCompetitor = defineTool({
  name: "remove_competitor",
  title: "Remove competitor",
  description:
    "Stops tracking a competitor (removes it from business.yaml). Its history stays in the database.",
  inputSchema: { name: z.string().min(1) },
  readOnly: false,
  handler: (a, ctx) => ctx.services.competitors.remove(a.name),
});

export const snapshotCompetitorWebsites = defineTool({
  name: "snapshot_competitor_websites",
  title: "Snapshot competitor websites",
  description:
    "Fetches each competitor's website (and your own) politely — robots.txt, 1 request/sec per site, public pages only — extracts title, headings, prices, offers, CTAs and social proof, stores a snapshot and reports what changed since the previous one.",
  inputSchema: {
    names: z
      .array(z.string())
      .optional()
      .describe('Limit to these brands ("self" = your own site). Default: all.'),
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.competitors.snapshotWebsites(a.names),
});

export const getCompetitorWebsiteChanges = defineTool({
  name: "get_competitor_website_changes",
  title: "Competitor website changes",
  description:
    "Differences between consecutive website snapshots (added/removed offers, prices, headings, CTAs, social proof, title) since a date (default 7 days ago).",
  inputSchema: { name: name.optional(), since: isoDateSchema.optional() },
  handler: (a, ctx) => ctx.services.competitors.websiteChanges(a),
});

export const getCompetitorProfile = defineTool({
  name: "get_competitor_profile",
  title: "Competitor profile",
  description:
    "Everything known about one competitor: latest website snapshot (offers, prices, CTAs, social proof), recent changes, stored ads (proven = running 30+ days), manual signals and estimated presence score.",
  inputSchema: { name },
  handler: (a, ctx) => ctx.services.competitors.profile(a.name),
});

export const fetchCompetitorAds = defineTool({
  name: "fetch_competitor_ads",
  title: "Fetch competitor ads (Ad Library API)",
  description:
    "Queries Meta's Ad Library API for competitor ads. IMPORTANT: commercial ads are only returned for EU countries; for others (e.g. BD) the result is usually empty and the tool returns public Ad Library links plus the manual import route.",
  inputSchema: {
    name: name.optional(),
    country: z.string().length(2).optional().describe("ISO-2 country (default business.country)."),
  },
  readOnly: false,
  openWorld: true,
  handler: (a, ctx) => ctx.services.competitors.fetchAds(a),
});

export const importCompetitorAds = defineTool({
  name: "import_competitor_ads",
  title: "Import competitor ads (manual)",
  description:
    "Loads competitor ads you saved by hand from data/competitors/<competitor-name>.csv or .json (columns: date_seen, headline, body, cta, format, landing_url, start_date, is_active). Re-importing updates, never duplicates.",
  inputSchema: {},
  readOnly: false,
  handler: (_a, ctx) => ctx.services.competitors.importAds(),
});

export const getCompetitorAds = defineTool({
  name: "get_competitor_ads",
  title: "Competitor ads",
  description:
    "Stored competitor ads with days running. proven_only = ads running 30+ days (likely profitable — study their hook, angle and offer).",
  inputSchema: {
    name: name.optional(),
    active_only: z.boolean().optional(),
    proven_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
  },
  handler: (a, ctx) => ctx.services.competitors.getAds(a),
});

export const recordCompetitorSignal = defineTool({
  name: "record_competitor_signal",
  title: "Record competitor signal",
  description:
    'Stores a manual number for a competitor or "self", e.g. social_followers, web_traffic (monthly visits), review_count — or any positioning signal name to override the derived value. Used by get_competitive_positioning.',
  inputSchema: {
    name,
    signal: z.string().regex(/^[a-z0-9_]{2,40}$/, "snake_case, e.g. social_followers"),
    value: z.number().finite(),
    note: z.string().max(500).optional(),
    date: isoDateSchema.optional().describe("Default today."),
  },
  readOnly: false,
  handler: (a, ctx) => ctx.services.competitors.recordSignal(a),
});

export const getAdLibraryLink = defineTool({
  name: "get_ad_library_link",
  title: "Ad Library link",
  description:
    "Public Meta Ad Library URL for a competitor (by page id when known, else keyword search) in your country.",
  inputSchema: { name },
  handler: (a, ctx) => ctx.services.competitors.adLibraryLink(a.name),
});

export const getCompetitivePositioning = defineTool({
  name: "get_competitive_positioning",
  title: "Competitive positioning (estimate)",
  description:
    "Ranks your brand and competitors by an ESTIMATED Market Presence Score from observable signals (ad activity, website offers, social proof, prices, manual follower/traffic numbers), with per-signal breakdown, data coverage % and confidence. Not a sales ranking.",
  inputSchema: {},
  handler: (_a, ctx) => ctx.services.positioning.compute(),
});

export const competitorTools: AnyToolDef[] = [
  listCompetitors,
  addCompetitor,
  removeCompetitor,
  snapshotCompetitorWebsites,
  getCompetitorWebsiteChanges,
  getCompetitorProfile,
  fetchCompetitorAds,
  importCompetitorAds,
  getCompetitorAds,
  recordCompetitorSignal,
  getAdLibraryLink,
  getCompetitivePositioning,
];
