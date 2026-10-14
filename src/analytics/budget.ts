import type { Verdict } from "../types/metrics.js";
import { safeDiv } from "./metrics.js";

export interface BudgetEntityInput {
  id: string;
  name: string;
  spend: number;
  conversions: number;
  verdict?: Verdict;
}

export interface BudgetRow extends BudgetEntityInput {
  spend_share: number | null;
  conversion_share: number | null;
  /** conversion_share / spend_share: >1 = gets more results than its share of budget. */
  efficiency_index: number | null;
}

/** Efficiency below this and spend share above MIN_SHARE → over-funded. Above UNDER_FUNDED (or a winner above 1) → under-funded. */
export const OVER_FUNDED_EFFICIENCY = 0.7;
export const UNDER_FUNDED_EFFICIENCY = 1.3;
export const MIN_SHARE = 0.05;

const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

export function budgetEfficiency(entities: readonly BudgetEntityInput[]) {
  const totalSpend = entities.reduce((s, e) => s + e.spend, 0);
  const totalConv = entities.reduce((s, e) => s + e.conversions, 0);
  const rows: BudgetRow[] = entities.map((e) => {
    const spendShare = safeDiv(e.spend, totalSpend);
    const convShare = totalConv > 0 ? safeDiv(e.conversions, totalConv) : null;
    return {
      ...e,
      spend: Math.round(e.spend * 100) / 100,
      spend_share: r4(spendShare),
      conversion_share: r4(convShare),
      efficiency_index: r4(
        spendShare && convShare !== null ? safeDiv(convShare, spendShare) : null,
      ),
    };
  });
  rows.sort((a, b) => b.spend - a.spend);

  const overFundedLosers = rows.filter(
    (r) =>
      r.verdict !== "learning" &&
      (r.spend_share ?? 0) >= MIN_SHARE &&
      (r.verdict === "loser" ||
        (r.efficiency_index !== null && r.efficiency_index < OVER_FUNDED_EFFICIENCY) ||
        (totalConv > 0 && r.conversions === 0)),
  );
  const underFundedWinners = rows.filter(
    (r) =>
      r.verdict !== "learning" &&
      r.verdict !== "loser" &&
      r.verdict !== "fatigued" &&
      r.efficiency_index !== null &&
      (r.efficiency_index >= UNDER_FUNDED_EFFICIENCY ||
        (r.verdict === "winner" && r.efficiency_index >= 1)),
  );
  return {
    total_spend: Math.round(totalSpend * 100) / 100,
    total_conversions: totalConv,
    rows,
    over_funded_losers: overFundedLosers,
    under_funded_winners: underFundedWinners.sort(
      (a, b) => (b.efficiency_index ?? 0) - (a.efficiency_index ?? 0),
    ),
  };
}
