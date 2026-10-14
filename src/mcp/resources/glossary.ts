import { BENCHMARKS } from "../../analytics/diagnostics.js";
import { FATIGUE_CPA_RISE, FATIGUE_CTR_DROP } from "../../analytics/fatigue.js";
import { LOSER_CPA_MULTIPLE } from "../../analytics/classify.js";
import { METRIC_DEFINITIONS } from "../../analytics/metrics.js";

/** Metric definitions and rules, generated from the code so it never drifts from what the tools compute. */
export function renderGlossary(): string {
  const lines = [
    "# Metric glossary",
    "",
    "All ratios are computed from **summed raw counts** over the period (never by averaging daily ratios).",
    "A metric that can't be computed (division by zero) is `null`.",
    "",
    "| Metric | Formula | Better | Notes |",
    "|---|---|---|---|",
    ...METRIC_DEFINITIONS.map(
      (d) => `| ${d.label} (\`${d.name}\`) | ${d.formula} | ${d.better} | ${d.notes ?? ""} |`,
    ),
    "",
    "## Verdicts",
    "- **learning** — spend below `classification.min_spend_for_verdict` or impressions below `min_impressions_for_verdict`.",
    `- **winner** — meets every configured target (CPA ≤ max_cpa; ROAS ≥ min_roas when purchase value is tracked). Without targets: cheapest 25% of ads by CPA.`,
    `- **loser** — CPA > ${LOSER_CPA_MULTIPLE}× max_cpa, or no conversions after spending ${LOSER_CPA_MULTIPLE}× max_cpa. Without targets: most expensive 25%.`,
    `- **fatigued** — was a winner in its previous 14 days, and recently: frequency ≥ fatigue_frequency AND (CTR down ≥ ${FATIGUE_CTR_DROP * 100}% OR CPA up ≥ ${FATIGUE_CPA_RISE * 100}%).`,
    "- **average** — everything else.",
    "",
    "## Comparisons",
    "`delta_pct` is a percentage change vs the previous equal-length period. `direction` is better/worse/flat and knows",
    "that CPA, CPC and CPM are lower-is-better; volume metrics (spend, impressions, reach, frequency) have no direction.",
    "",
    "## Funnel benchmarks (rules of thumb)",
    ...Object.entries(BENCHMARKS).map(([k, v]) => `- \`${k}\`: ${v}`),
    "",
    "## Budget efficiency",
    "efficiency_index = share of conversions ÷ share of spend. Above 1 = the entity earns more results than its share of budget.",
  ];
  return lines.join("\n") + "\n";
}
