import type { MetricSet } from "../types/metrics.js";

/** Rule-of-thumb benchmarks used for funnel flags. Tune here; documented in the glossary. */
export const BENCHMARKS = {
  hook_rate_min: 0.25,
  hold_rate_min: 0.15,
  ctr_min_default: 0.01,
  lpv_rate_min: 0.6,
  atc_rate_min: 0.05,
  cart_to_purchase_min: 0.2,
  cpm_rise_saturation: 0.15,
  ctr_stable_band: 0.1,
  min_link_clicks: 50,
  min_lpv: 100,
  min_add_to_cart: 10,
};

export type FlagCode =
  | "LOW_HOOK_RATE"
  | "LOW_HOLD_RATE"
  | "LOW_CTR"
  | "LANDING_PAGE_DROP_OFF"
  | "OFFER_OR_PAGE_PROBLEM"
  | "CHECKOUT_OR_TRUST_PROBLEM"
  | "AUDIENCE_SATURATION";

export interface DiagnosticFlag {
  code: FlagCode;
  severity: "high" | "medium" | "low";
  likely_cause: string;
  evidence: Record<string, number | null>;
}

export interface FunnelStep {
  step: string;
  from: number;
  to: number;
  rate: number | null;
}

const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

export function funnelSteps(m: MetricSet): FunnelStep[] {
  const step = (name: string, from: number, to: number): FunnelStep => ({
    step: name,
    from,
    to,
    rate: from > 0 ? r4(to / from) : null,
  });
  return [
    step("impression → link click", m.impressions, m.link_clicks),
    step("link click → landing page view", m.link_clicks, m.landing_page_views),
    step("landing page view → add to cart", m.landing_page_views, m.add_to_cart),
    step("add to cart → checkout", m.add_to_cart, m.initiate_checkout),
    step("checkout → purchase", m.initiate_checkout, m.purchases),
  ];
}

/** Rule-based problem flags Claude can expand on. `previous` enables the saturation check. */
export function diagnose(
  m: MetricSet,
  opts: { minCtr?: number; previous?: MetricSet } = {},
): DiagnosticFlag[] {
  const flags: DiagnosticFlag[] = [];
  const B = BENCHMARKS;
  const minCtr = opts.minCtr ?? B.ctr_min_default;

  if (m.video_3s_views > 0 && m.hook_rate !== null && m.hook_rate < B.hook_rate_min) {
    flags.push({
      code: "LOW_HOOK_RATE",
      severity: m.hook_rate < B.hook_rate_min * 0.7 ? "high" : "medium",
      likely_cause:
        "The first 3 seconds of the video don't stop the scroll — test a new opening (hook).",
      evidence: { hook_rate: r4(m.hook_rate), benchmark: B.hook_rate_min },
    });
  }
  if (m.video_3s_views > 0 && m.hold_rate !== null && m.hold_rate < B.hold_rate_min) {
    flags.push({
      code: "LOW_HOLD_RATE",
      severity: "low",
      likely_cause: "Viewers drop after the hook — tighten pacing or move the payoff earlier.",
      evidence: { hold_rate: r4(m.hold_rate), benchmark: B.hold_rate_min },
    });
  }
  if (m.impressions >= 1000 && m.ctr !== null && m.ctr < minCtr) {
    flags.push({
      code: "LOW_CTR",
      severity: m.ctr < minCtr * 0.6 ? "high" : "medium",
      likely_cause:
        "Creative or offer isn't compelling enough to click — test new angles, headlines or offers.",
      evidence: { ctr: r4(m.ctr), benchmark: minCtr },
    });
  }
  if (m.link_clicks >= B.min_link_clicks && m.lpv_rate !== null && m.lpv_rate < B.lpv_rate_min) {
    flags.push({
      code: "LANDING_PAGE_DROP_OFF",
      severity: m.lpv_rate < 0.5 ? "high" : "medium",
      likely_cause:
        m.ctr !== null && m.ctr >= minCtr
          ? "People click but the page doesn't load for them — check landing page speed/mobile load, redirects, or accidental clicks."
          : "Many clicks never become page views — check page speed and whether clicks are accidental.",
      evidence: { lpv_rate: r4(m.lpv_rate), benchmark: B.lpv_rate_min, ctr: r4(m.ctr) },
    });
  }
  if (
    m.landing_page_views >= B.min_lpv &&
    m.lpv_rate !== null &&
    m.lpv_rate >= B.lpv_rate_min &&
    m.atc_rate !== null &&
    m.atc_rate < B.atc_rate_min
  ) {
    flags.push({
      code: "OFFER_OR_PAGE_PROBLEM",
      severity: m.atc_rate < B.atc_rate_min / 2 ? "high" : "medium",
      likely_cause:
        "Visitors arrive but don't add to cart — the offer, price, or product page isn't convincing (or doesn't match the ad).",
      evidence: {
        atc_rate: r4(m.atc_rate),
        benchmark: B.atc_rate_min,
        landing_page_views: m.landing_page_views,
      },
    });
  }
  if (m.add_to_cart >= B.min_add_to_cart) {
    const cartToPurchase = m.purchases / m.add_to_cart;
    if (cartToPurchase < B.cart_to_purchase_min) {
      flags.push({
        code: "CHECKOUT_OR_TRUST_PROBLEM",
        severity: cartToPurchase < B.cart_to_purchase_min / 2 ? "high" : "medium",
        likely_cause:
          "Carts are abandoned — check delivery charges/time, payment options (COD), checkout friction, and trust signals.",
        evidence: {
          cart_to_purchase_rate: r4(cartToPurchase),
          benchmark: B.cart_to_purchase_min,
          checkout_rate: r4(m.checkout_rate),
          purchase_rate: r4(m.purchase_rate),
        },
      });
    }
  }
  const prev = opts.previous;
  if (
    prev &&
    prev.cpm &&
    m.cpm &&
    prev.ctr &&
    m.ctr &&
    m.impressions >= 1000 &&
    prev.impressions >= 1000
  ) {
    const cpmChange = (m.cpm - prev.cpm) / prev.cpm;
    const ctrChange = (m.ctr - prev.ctr) / prev.ctr;
    if (cpmChange >= B.cpm_rise_saturation && Math.abs(ctrChange) <= B.ctr_stable_band) {
      flags.push({
        code: "AUDIENCE_SATURATION",
        severity: cpmChange >= 0.3 ? "high" : "medium",
        likely_cause:
          "Costs to reach people are rising while engagement is stable — audience saturation or more competition in the auction.",
        evidence: {
          cpm_change: r4(cpmChange),
          ctr_change: r4(ctrChange),
          cpm: r4(m.cpm),
          previous_cpm: r4(prev.cpm),
        },
      });
    }
  }
  return flags;
}
