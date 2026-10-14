import type { MetricSet, Reason, Verdict } from "../types/metrics.js";

/** CTR must fall at least this much vs. the ad's own baseline. */
export const FATIGUE_CTR_DROP = 0.2;
/** …or CPA must rise at least this much. */
export const FATIGUE_CPA_RISE = 0.25;

export interface FatigueInput {
  recent: MetricSet;
  baseline: MetricSet;
  /** Verdict of the baseline window on its own (fatigue requires a former winner). */
  baselineVerdict: Verdict;
}

export interface FatigueResult {
  fatigued: boolean;
  /** Partial signals worth watching even when not (yet) fatigued. */
  watch: boolean;
  reasons: Reason[];
}

const pct = (v: number) => Math.round(v * 1000) / 10;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Creative fatigue: a former winner whose recent frequency ≥ threshold AND
 * (CTR down ≥ 20% vs its baseline OR CPA up ≥ 25%).
 */
export function evaluateFatigue(
  input: FatigueInput,
  opts: { frequencyThreshold: number; minImpressions: number },
): FatigueResult {
  const { recent, baseline } = input;
  const reasons: Reason[] = [];
  if (recent.impressions < opts.minImpressions || baseline.impressions < opts.minImpressions) {
    return {
      fatigued: false,
      watch: false,
      reasons: [
        { code: "NOT_ENOUGH_DATA", value: recent.impressions, target: opts.minImpressions },
      ],
    };
  }

  const freq = recent.frequency;
  const highFreq = freq !== null && freq >= opts.frequencyThreshold;
  if (freq !== null) {
    reasons.push({
      code: highFreq ? "FREQUENCY_HIGH" : "FREQUENCY_OK",
      value: Math.round(freq * 100) / 100,
      target: opts.frequencyThreshold,
      baseline: baseline.frequency === null ? null : Math.round(baseline.frequency * 100) / 100,
    });
  }

  let ctrDrop = false;
  if (recent.ctr !== null && baseline.ctr !== null && baseline.ctr > 0) {
    const change = (recent.ctr - baseline.ctr) / baseline.ctr;
    ctrDrop = change <= -FATIGUE_CTR_DROP;
    if (ctrDrop)
      reasons.push({
        code: "CTR_DROP",
        value: pct(change),
        target: -pct(FATIGUE_CTR_DROP),
        recent: r4(recent.ctr),
        baseline: r4(baseline.ctr),
      });
  }

  let cpaRise = false;
  if (baseline.cpa !== null) {
    if (recent.cpa === null) {
      cpaRise = recent.spend >= baseline.cpa * (1 + FATIGUE_CPA_RISE);
      if (cpaRise)
        reasons.push({
          code: "CONVERSIONS_STOPPED",
          value: 0,
          baseline: Math.round(baseline.cpa * 100) / 100,
        });
    } else {
      const change = (recent.cpa - baseline.cpa) / baseline.cpa;
      cpaRise = change >= FATIGUE_CPA_RISE;
      if (cpaRise) {
        reasons.push({
          code: "CPA_RISE",
          value: pct(change),
          target: pct(FATIGUE_CPA_RISE),
          recent: Math.round(recent.cpa * 100) / 100,
          baseline: Math.round(baseline.cpa * 100) / 100,
        });
      }
    }
  }

  const wasWinner = input.baselineVerdict === "winner";
  reasons.push({
    code: wasWinner ? "WAS_WINNER" : "WAS_NOT_WINNER",
    baseline_verdict: input.baselineVerdict,
  });
  const fatigued = wasWinner && highFreq && (ctrDrop || cpaRise);
  const nearFreq = freq !== null && freq >= opts.frequencyThreshold * 0.8;
  const watch =
    !fatigued &&
    (((highFreq || nearFreq) && (ctrDrop || cpaRise)) ||
      (wasWinner && (ctrDrop || cpaRise || highFreq)));
  return { fatigued, watch, reasons };
}
