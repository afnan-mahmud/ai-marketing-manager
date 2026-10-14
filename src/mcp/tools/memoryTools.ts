import { z } from "zod";
import { CONFIDENCES, LEARNING_CATEGORIES, LEARNING_KINDS } from "../../analytics/memory.js";
import type { AnyToolDef } from "../tooling.js";
import { defineTool } from "../tooling.js";

export const getMemoryBriefing = defineTool({
  name: "get_memory_briefing",
  title: "Memory briefing",
  description:
    "What this client's marketing manager has learned so far: the strongest 'do' and 'avoid' lessons, insights, conflicting or stale lessons, and confirmed Ads Manager changes waiting for an outcome review. Call it at the start of any analysis or plan, and let it shape recommendations.",
  inputSchema: {},
  handler: (_a, ctx) => ctx.services.memory.briefing(),
});

export const getLearnings = defineTool({
  name: "get_learnings",
  title: "Search memory",
  description:
    'Lessons in this client\'s memory, ranked by confidence, confirmations and recency; filter by category, kind or words (e.g. "UGC video", "discount").',
  inputSchema: {
    category: z.enum(LEARNING_CATEGORIES).optional(),
    kind: z.enum(LEARNING_KINDS).optional(),
    query: z.string().max(200).optional(),
    include_retired: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Default 30."),
  },
  handler: (a, ctx) => ctx.services.memory.list(a),
});

export const recordLearning = defineTool({
  name: "record_learning",
  title: "Remember a lesson",
  description:
    "Saves a lesson to this client's memory: 'do' (worked — repeat it), 'avoid' (didn't work — don't repeat), or 'insight'. Only record lessons backed by data or a clear outcome, written as a reusable rule with its conditions (e.g. \"UGC testimonial videos get ~35% lower CPA than static discount banners for women 20-35 in Dhaka\"). Put the numbers in evidence. A lesson matching an existing one is counted as a confirmation; one contradicting it is flagged. Pass action_id when the lesson comes from review_action_outcomes.",
  inputSchema: {
    statement: z.string().min(10).max(500),
    kind: z.enum(LEARNING_KINDS),
    category: z.enum(LEARNING_CATEGORIES),
    evidence: z
      .string()
      .min(5)
      .max(2000)
      .describe("Facts behind it: ads, periods, numbers, report or action ids."),
    confidence: z
      .enum(CONFIDENCES)
      .optional()
      .describe("Default low; rises automatically as the lesson is confirmed again."),
    source: z
      .enum(["daily_briefing", "weekly_review", "action_outcome", "campaign_plan", "user", "other"])
      .optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    related: z
      .array(z.string().max(200))
      .max(20)
      .optional()
      .describe("Ad / ad set / campaign names or ids."),
    action_id: z.string().max(16).optional(),
  },
  readOnly: false,
  handler: (a, ctx) => ctx.services.memory.record(a),
});

export const updateLearning = defineTool({
  name: "update_learning",
  title: "Update a lesson",
  description:
    "Confirms, contradicts, retires (no longer true), reactivates or edits a lesson by id. Use contradict/retire when new data disproves a lesson, and when the user says a lesson is wrong.",
  inputSchema: {
    id: z.number().int().positive(),
    action: z.enum(["confirm", "contradict", "retire", "reactivate", "edit"]),
    note: z.string().max(2000).optional().describe("Why (evidence)."),
    statement: z.string().min(10).max(500).optional().describe("edit only"),
    confidence: z.enum(CONFIDENCES).optional(),
  },
  readOnly: false,
  handler: (a, ctx) => ctx.services.memory.update(a),
});

export const reviewActionOutcomes = defineTool({
  name: "review_action_outcomes",
  title: "Review results of past changes",
  description:
    "For Ads Manager changes the user confirmed (new ads, campaigns, pauses, budget changes, duplicates) at least a few days ago: the target's metrics after vs before, the account's change, and a verdict for new ads/ad sets. Facts only — decide what each teaches and save it with record_learning(action_id).",
  inputSchema: {
    min_days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Days of data needed after a change (default 3)."),
    include_reviewed: z.boolean().optional(),
  },
  readOnly: false,
  handler: (a, ctx) => ctx.services.memory.reviewOutcomes(a),
});

export const memoryTools: AnyToolDef[] = [
  getMemoryBriefing,
  getLearnings,
  recordLearning,
  updateLearning,
  reviewActionOutcomes,
];
