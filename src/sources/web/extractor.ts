import * as cheerio from "cheerio";
import type { DetectedPrice, ExtractedPage, SocialProof } from "../../types/competitor.js";

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";
const toAsciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const MAX_TEXT = 60_000;

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/^(৳|tk\.?|taka|bdt|টাকা)$/i, "BDT"],
  [/^(\$|usd|us\$)$/i, "USD"],
  [/^(€|eur)$/i, "EUR"],
  [/^(£|gbp)$/i, "GBP"],
  [/^(₹|rs\.?|inr)$/i, "INR"],
  [/^(rm|myr)$/i, "MYR"],
  [/^(aed|dhs?)$/i, "AED"],
];
const CUR = "৳|Tk\\.?|BDT|Taka|টাকা|\\$|USD|US\\$|€|EUR|£|GBP|₹|Rs\\.?|INR|RM|MYR|AED";
const AMOUNT = "\\d{1,3}(?:[,\\s]\\d{2,3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?";
const PRICE_BEFORE = new RegExp(`(${CUR})\\s?(${AMOUNT})`, "gi");
const PRICE_AFTER = new RegExp(`(${AMOUNT})\\s?(${CUR})(?![a-z])`, "gi");

function currencyCode(sym: string): string | null {
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(sym.trim())) return code;
  return null;
}

/** Offer phrases worth tracking. Each regex captures a short label; the surrounding sentence is kept. */
const OFFER_PATTERNS: RegExp[] = [
  /\b(?:up to\s+)?\d{1,2}\s?%\s?(?:off|discount|ছাড়)/i,
  /(?:flat|save|extra)\s+(?:৳|tk\.?|\$|rs\.?)?\s?\d[\d,]*\s?(?:৳|tk|taka|off)?/i,
  /free\s+(?:home\s+)?(?:delivery|shipping)/i,
  /cash\s+on\s+delivery|\bCOD\b/i,
  /buy\s+\d+\s+get\s+\d+(?:\s+free)?|\bBOGO\b/i,
  /\b(?:bundle|combo)\b(?:\s+(?:offer|deal|pack))?/i,
  /limited[-\s](?:time|stock|offer|edition)|today only|ends (?:soon|tonight|today)|last chance/i,
  /(?:flash|mega|big|season(?:al)?|clearance)\s+sale/i,
  /free\s+gift|gift\s+with\s+purchase/i,
  /(?:promo|coupon|discount)\s+code|voucher/i,
  /cash\s?back/i,
  /money[-\s]back|\d+[-\s]day\s+(?:guarantee|return)|easy returns?/i,
  /first\s+order|new customer/i,
];

const CTA_WORDS =
  /^(shop now|buy now|order now|add to cart|add to bag|get (it|started|yours|offer)|sign up|subscribe|learn more|book now|contact us|call now|claim|try (it|now|free)|download|join|start|see (more|offer)|order on whatsapp|message us|এখনই কিনুন|অর্ডার করুন)/i;

function parseCount(s: string): number | null {
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s?(k|m|lakh|hazar)?/i);
  if (!m) return null;
  let n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "hazar") n *= 1_000;
  if (unit === "m") n *= 1_000_000;
  if (unit === "lakh") n *= 100_000;
  return Number.isFinite(n) ? n : null;
}

function sentenceAround(text: string, index: number, len: number, max = 140): string {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1, index - max / 2);
  let end = text.indexOf(".", index + len);
  if (end < 0 || end - start > max) end = Math.min(text.length, index + len + max / 2);
  return clean(text.slice(start, end));
}

function dedupe<T>(items: T[], key: (t: T) => string, max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

export function detectPrices(text: string): DetectedPrice[] {
  const found: DetectedPrice[] = [];
  const push = (raw: string, sym: string, amount: string, index: number) => {
    const value = Number(amount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return;
    found.push({
      value,
      currency: currencyCode(sym),
      text: clean(raw),
      context: sentenceAround(text, index, raw.length, 100),
    });
  };
  for (const m of text.matchAll(PRICE_BEFORE)) push(m[0], m[1]!, m[2]!, m.index ?? 0);
  for (const m of text.matchAll(PRICE_AFTER)) push(m[0], m[2]!, m[1]!, m.index ?? 0);
  return dedupe(found, (p) => `${p.currency}|${p.value}|${p.context.slice(0, 40)}`, 50);
}

export function detectOffers(text: string): string[] {
  const out: string[] = [];
  for (const re of OFFER_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g))
      out.push(sentenceAround(text, m.index ?? 0, m[0].length, 120));
  }
  return dedupe(out, (o) => o.toLowerCase(), 40);
}

export function detectSocialProof(text: string): SocialProof[] {
  const out: SocialProof[] = [];
  for (const m of text.matchAll(/(\d(?:\.\d)?)\s?(?:\/\s?5|out of 5|stars?|★)/gi)) {
    const v = Number(m[1]);
    if (v > 0 && v <= 5)
      out.push({
        kind: "rating",
        value: v,
        text: sentenceAround(text, m.index ?? 0, m[0].length, 80),
      });
  }
  for (const m of text.matchAll(
    /([\d,.]+\s?(?:k|m|lakh)?)\+?\s+(?:verified\s+)?(reviews?|ratings?)/gi,
  )) {
    out.push({
      kind: "reviews",
      value: parseCount(m[1]!),
      text: sentenceAround(text, m.index ?? 0, m[0].length, 80),
    });
  }
  for (const m of text.matchAll(
    /([\d,.]+\s?(?:k|m|lakh)?)\+?\s+(?:happy\s+|satisfied\s+|trusted\s+by\s+)?(customers|clients|users|orders sold|orders)/gi,
  )) {
    out.push({
      kind: "customers",
      value: parseCount(m[1]!),
      text: sentenceAround(text, m.index ?? 0, m[0].length, 80),
    });
  }
  return dedupe(out, (p) => `${p.kind}|${p.value}`, 30);
}

/** Extracts the marketing-relevant facts of a page: title, headings, prices, offers, CTAs, social proof. */
export function extractPage(html: string): ExtractedPage {
  const $ = cheerio.load(html);
  const title = clean($("title").first().text()) || null;
  const meta =
    clean(
      $('meta[name="description"]').attr("content") ??
        $('meta[property="og:description"]').attr("content") ??
        "",
    ) || null;

  // Testimonials (by class) before stripping.
  const testimonials: SocialProof[] = [];
  $('[class*="testimonial"], [class*="review-item"], [class*="customer-review"]').each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 20)
      testimonials.push({ kind: "testimonial", value: null, text: t.slice(0, 160) });
  });

  $("script, style, noscript, svg, template, iframe").remove();

  const headings: ExtractedPage["headings"] = [];
  $("h1, h2, h3").each((_, el) => {
    const text = clean($(el).text());
    if (text && text.length <= 200)
      headings.push({ level: Number(el.tagName.slice(1)) as 1 | 2 | 3, text });
  });

  const ctas: string[] = [];
  $(
    'button, input[type="submit"], [role="button"], a[class*="btn"], a[class*="button"], a[class*="cta"]',
  ).each((_, el) => {
    const t = clean($(el).is("input") ? ($(el).attr("value") ?? "") : $(el).text());
    if (t.length >= 2 && t.length <= 40) ctas.push(t);
  });
  $("a").each((_, el) => {
    const t = clean($(el).text());
    if (t.length <= 40 && CTA_WORDS.test(t)) ctas.push(t);
  });

  // Block-level elements get line breaks so sentences don't run together.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article, header, footer, span").each(
    (_, el) => {
      $(el).append(" \n");
    },
  );
  const text = toAsciiDigits(clean($("body").text() || $.root().text())).slice(0, MAX_TEXT);

  return {
    title,
    meta_description: meta,
    headings: dedupe(headings, (h) => `${h.level}|${h.text.toLowerCase()}`, 60),
    prices: detectPrices(text),
    offers: detectOffers(text),
    ctas: dedupe(ctas, (c) => c.toLowerCase(), 30),
    social_proof: [...detectSocialProof(text), ...dedupe(testimonials, (t) => t.text, 10)],
    text,
  };
}
