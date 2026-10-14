// Generates examples/sample-meta-export.csv: realistic, deterministic fake Meta Ads Manager data
// (30 days × 12 ads × 3 campaigns, BDT). Seeded scenarios: clear winners, losers, a fatiguing ad,
// a learning ad, a landing-page problem, a low-hook video and a checkout drop-off.
// Run: node scripts/generate-sample-data.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const START = "2026-09-14";
const DAYS = 30; // 2026-09-14 .. 2026-10-13
const PRICE = 1200;

// mulberry32 PRNG — deterministic output
let seed = 20261013;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = (pct) => 1 + (rand() * 2 - 1) * pct;

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const C1 = { name: "Vitamin C Serum | Sales", objective: "OUTCOME_SALES" };
const C2 = { name: "Retargeting | Sales", objective: "OUTCOME_SALES" };
const C3 = { name: "Prospecting | Traffic", objective: "OUTCOME_TRAFFIC" };
const URL = "https://mybrand.com/products/vitamin-c-serum";

// cpa = target cost per purchase (Infinity = never converts). Phase overrides apply from `from` (day index).
const ads = [
  {
    c: C1,
    adset: "Women 20-35 | Dhaka",
    name: "UGC Review - Nadia",
    format: "Video",
    spend: 1500,
    cpm: 140,
    ctr: 0.021,
    lpv: 0.82,
    cpa: 300,
    freq: 1.25,
    hook: 0.38,
    atcMult: 3.4,
    headline: "Nadia's 30-day glow results",
    body: "I tried this Vitamin C serum for 30 days. Here's my honest review — no filter. Cash on delivery all over Bangladesh.",
    cta: "SHOP_NOW",
  },
  {
    c: C1,
    adset: "Women 20-35 | Dhaka",
    name: "Before-After Reel",
    format: "Video",
    spend: 1200,
    cpm: 130,
    ctr: 0.024,
    lpv: 0.8,
    cpa: 250,
    freq: 1.3,
    hook: 0.42,
    atcMult: 3.3,
    phase: { from: 23, ctr: 0.012, cpa: 650, freq: [3.2, 4.0], cpm: 165, hook: 0.27 },
    headline: "Dull skin → bright skin in 4 weeks",
    body: "Real before & after. 15% Vitamin C + Ferulic acid. Free delivery inside Dhaka.",
    cta: "SHOP_NOW",
  },
  {
    c: C1,
    adset: "Women 20-35 | Dhaka",
    name: "Static Discount Banner",
    format: "Image",
    spend: 800,
    cpm: 110,
    ctr: 0.022,
    lpv: 0.45,
    cpa: 1100,
    freq: 1.4,
    atcMult: 3.0,
    headline: "20% OFF Vitamin C Serum",
    body: "Flat 20% off this week only. Limited stock!",
    cta: "SHOP_NOW",
  },
  {
    c: C1,
    adset: "Women 25-40 | Chattogram",
    name: "Carousel - 3 Benefits",
    format: "Carousel",
    spend: 900,
    cpm: 120,
    ctr: 0.015,
    lpv: 0.78,
    cpa: 460,
    freq: 1.2,
    atcMult: 3.5,
    headline: "Brighten. Protect. Even tone.",
    body: "3 reasons dermatologists love Vitamin C. Swipe to see the science.",
    cta: "LEARN_MORE",
  },
  {
    c: C1,
    adset: "Women 25-40 | Chattogram",
    name: "Founder Story Video",
    format: "Video",
    spend: 1000,
    cpm: 125,
    ctr: 0.017,
    lpv: 0.81,
    cpa: 340,
    freq: 1.2,
    hook: 0.33,
    atcMult: 3.2,
    headline: "Why I started My Brand",
    body: "I couldn't find a Vitamin C serum that was honest about its ingredients — so we made one. Made for Bangladeshi weather.",
    cta: "SHOP_NOW",
  },
  {
    c: C1,
    adset: "Women 25-40 | Chattogram",
    name: "Testimonial Static",
    format: "Image",
    spend: 600,
    cpm: 105,
    ctr: 0.012,
    lpv: 0.79,
    cpa: 520,
    freq: 1.3,
    atcMult: 3.6,
    headline: '"My dark spots faded" — Farzana, Chattogram',
    body: "4.8★ from 2,300+ customers. Try it risk-free with cash on delivery.",
    cta: "SHOP_NOW",
  },
  {
    c: C2,
    adset: "Website visitors 30d",
    name: "Free Delivery Offer",
    format: "Image",
    spend: 700,
    cpm: 190,
    ctr: 0.028,
    lpv: 0.85,
    cpa: 200,
    freq: 2.1,
    atcMult: 2.6,
    headline: "Still thinking? Delivery is on us",
    body: "Free home delivery anywhere in Bangladesh — today only. Cash on delivery available.",
    cta: "ORDER_NOW",
  },
  {
    c: C2,
    adset: "Website visitors 30d",
    name: "Limited Stock Countdown",
    format: "Video",
    spend: 650,
    cpm: 200,
    ctr: 0.009,
    lpv: 0.8,
    cpa: 900,
    freq: 2.3,
    hook: 0.16,
    atcMult: 3.5,
    headline: "Only 50 bottles left",
    body: "Our last batch is almost gone. Order before the timer ends.",
    cta: "SHOP_NOW",
  },
  {
    c: C2,
    adset: "Add to cart 14d",
    name: "Bundle Offer Carousel",
    format: "Carousel",
    spend: 500,
    cpm: 210,
    ctr: 0.025,
    lpv: 0.84,
    cpa: 430,
    freq: 2.4,
    atcMult: 9.0,
    headline: "Serum + Sunscreen bundle — save 300৳",
    body: "Complete your routine: Vitamin C by day, SPF 50 to protect it.",
    cta: "SHOP_NOW",
  },
  {
    c: C3,
    adset: "Broad 18-45",
    name: "How To Use Video",
    format: "Video",
    spend: 700,
    cpm: 90,
    ctr: 0.016,
    lpv: 0.76,
    cpa: 560,
    freq: 1.15,
    hook: 0.22,
    atcMult: 3.8,
    headline: "3 drops, every morning",
    body: "How to use Vitamin C serum the right way (most people get step 2 wrong).",
    cta: "LEARN_MORE",
  },
  {
    c: C3,
    adset: "Broad 18-45",
    name: "New Launch Teaser",
    format: "Video",
    start: 27,
    spend: 280,
    cpm: 95,
    ctr: 0.014,
    lpv: 0.8,
    cpa: 500,
    freq: 1.1,
    hook: 0.3,
    atcMult: 3.5,
    headline: "Something new is coming",
    body: "Our Niacinamide serum launches next week. Be the first to know.",
    cta: "LEARN_MORE",
  },
  {
    c: C3,
    adset: "Broad 18-45",
    name: "Ingredient Spotlight",
    format: "Image",
    spend: 400,
    cpm: 85,
    ctr: 0.011,
    lpv: 0.74,
    cpa: Infinity,
    freq: 1.2,
    atcRate: 0.015,
    headline: "What is Ferulic acid?",
    body: "The ingredient that makes Vitamin C last 8x longer on your skin.",
    cta: "LEARN_MORE",
  },
];

const headers = [
  "Reporting starts",
  "Reporting ends",
  "Day",
  "Campaign name",
  "Ad set name",
  "Ad name",
  "Objective",
  "Amount spent (BDT)",
  "Impressions",
  "Reach",
  "Frequency",
  "Clicks (all)",
  "Link clicks",
  "CTR (link click-through rate)",
  "Landing page views",
  "Adds to cart",
  "Checkouts initiated",
  "Purchases",
  "Purchases conversion value",
  "3-second video plays",
  "ThruPlays",
  "Headline",
  "Body",
  "Call to action",
  "Format",
  "Website URL",
];

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [];
const end = addDays(START, DAYS - 1);
for (let day = 0; day < DAYS; day++) {
  const date = addDays(START, day);
  for (const ad of ads) {
    if ((ad.start ?? 0) > day) continue;
    ad.acc ??= 0;
    const ph = ad.phase && day >= ad.phase.from ? ad.phase : null;
    const cpm = (ph?.cpm ?? ad.cpm) * noise(0.06);
    const ctr = (ph?.ctr ?? ad.ctr) * noise(0.08);
    const cpa = ph?.cpa ?? ad.cpa;
    let freq = ad.freq * noise(0.05);
    if (ph?.freq) {
      const [a, b] = ph.freq;
      freq = a + ((b - a) * (day - ph.from)) / Math.max(1, DAYS - 1 - ph.from);
    }
    const spend = Math.round(ad.spend * noise(0.08) * 100) / 100;
    const impressions = Math.round((spend / cpm) * 1000);
    const reach = Math.round(impressions / freq);
    const linkClicks = Math.round(impressions * ctr);
    const clicksAll = Math.round(linkClicks * (1.6 + rand() * 0.3));
    const lpv = Math.round(linkClicks * ad.lpv * noise(0.04));
    // Deterministic fractional accumulation keeps each ad's CPA on target over the month.
    const expected = Number.isFinite(cpa) ? spend / cpa : 0;
    const purchases = Math.floor(ad.acc + expected) - Math.floor(ad.acc);
    ad.acc += expected;
    const atc = ad.atcRate
      ? Math.round(lpv * ad.atcRate)
      : Math.round(purchases * ad.atcMult + rand());
    const ic = Math.max(
      purchases,
      Math.round(purchases * 1.7 + (ad.atcMult > 6 ? purchases * 1.5 : 0)),
    );
    const value = Math.round(purchases * PRICE * (1 + rand() * 0.12));
    const isVideo = ad.format === "Video";
    const hook = ph?.hook ?? ad.hook ?? 0;
    const v3 = isVideo ? Math.round(impressions * hook * noise(0.05)) : 0;
    const thru = isVideo ? Math.round(v3 * 0.24 * noise(0.08)) : 0;
    rows.push([
      START,
      end,
      date,
      ad.c.name,
      ad.adset,
      ad.name,
      ad.c.objective,
      spend.toFixed(2),
      impressions,
      reach,
      (impressions / reach).toFixed(2),
      clicksAll,
      linkClicks,
      ((linkClicks / impressions) * 100).toFixed(2),
      lpv,
      atc,
      ic,
      purchases,
      value,
      v3,
      thru,
      ad.headline,
      ad.body,
      ad.cta,
      ad.format,
      URL,
    ]);
  }
}

const out = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const target = join(root, "examples", "sample-meta-export.csv");
writeFileSync(target, out);
process.stderr.write(`Wrote ${rows.length} rows to ${target}\n`);
