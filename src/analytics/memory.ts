import { similarity, trendTokens } from "./trends.js";

export const LEARNING_KINDS = ["do", "avoid", "insight"] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export const LEARNING_CATEGORIES = [
  "creative",
  "copy",
  "offer",
  "audience",
  "budget",
  "funnel",
  "timing",
  "market",
  "competitor",
  "general",
] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export interface ScorableLearning {
  confidence: Confidence;
  confirmations: number;
  contradictions: number;
  last_confirmed_at: string;
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = { low: 0.5, medium: 1, high: 1.5 };
/** A lesson not re-confirmed for this many days counts half as much. */
export const MEMORY_HALF_LIFE_DAYS = 90;
/** Lessons in the same category whose wording overlaps at least this much are treated as the same lesson. */
export const SAME_LESSON_SIMILARITY = 0.5;

/**
 * How much a lesson should weigh in today's recommendations: confidence × (1 + log2(confirmations)),
 * halved every 90 days without re-confirmation, divided by (1 + contradictions).
 */
export function learningScore(l: ScorableLearning, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(l.last_confirmed_at)) / 86_400_000);
  const recency = 0.5 ** (ageDays / MEMORY_HALF_LIFE_DAYS);
  const raw =
    (CONFIDENCE_WEIGHT[l.confidence] * (1 + Math.log2(Math.max(1, l.confirmations))) * recency) /
    (1 + l.contradictions);
  return Math.round(raw * 100) / 100;
}

export function higherConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCES.indexOf(a) >= CONFIDENCES.indexOf(b) ? a : b;
}

/** Confidence the evidence supports by repetition alone (Claude's own rating may be higher). */
export function confidenceFromConfirmations(confirmations: number): Confidence {
  return confirmations >= 5 ? "high" : confirmations >= 2 ? "medium" : "low";
}

/** The most similar existing lesson in the same category, if similar enough. */
export function findSameLesson<T extends { statement: string; category: string }>(
  statement: string,
  category: string,
  candidates: readonly T[],
): { match: T; similarity: number } | null {
  const tokens = trendTokens(statement);
  let best: { match: T; similarity: number } | null = null;
  for (const c of candidates) {
    if (c.category !== category) continue;
    const sim = similarity(tokens, trendTokens(c.statement));
    if (sim >= SAME_LESSON_SIMILARITY && (!best || sim > best.similarity))
      best = { match: c, similarity: Math.round(sim * 100) / 100 };
  }
  return best;
}

/** True if the query's words appear in the lesson (for memory search). */
export function matchesQuery(text: string, query: string): boolean {
  const q = trendTokens(query);
  if (!q.size) return true;
  const t = trendTokens(text);
  let hit = 0;
  for (const w of q) if (t.has(w) || [...t].some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
  return hit / q.size >= 0.5;
}
