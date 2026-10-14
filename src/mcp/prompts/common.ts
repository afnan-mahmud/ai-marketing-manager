import { z } from "zod";
import type { AppContext, ProjectInfo } from "../../context.js";
import { shiftDate } from "../../utils/dates.js";

export type PromptArgs = Record<string, string | undefined>;

/** What a prompt is built with: the target project (null if none exists/selected) and the date. */
export interface PromptCtx {
  project: AppContext | null;
  /** All projects in the workspace (to tell Claude what exists when none is selected). */
  projects: ProjectInfo[];
  today: () => string;
}

export function promptCtxFor(ctx: AppContext): PromptCtx {
  return { project: ctx, projects: [ctx.project], today: ctx.today };
}

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** MCP prompt arguments are always optional strings. */
  argsSchema: Record<string, z.ZodOptional<z.ZodString>>;
  build: (args: PromptArgs, ctx: PromptCtx) => string;
}

export const optionalArg = (description: string) => z.string().optional().describe(description);

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  bn: "Bengali (Bangla)",
  hi: "Hindi",
  ur: "Urdu",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  id: "Indonesian",
  ms: "Malay",
  tr: "Turkish",
  ne: "Nepali",
  ta: "Tamil",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

/** Which client project the workflow is for; every tool call must target it explicitly. */
export function projectRules(ctx: PromptCtx): string {
  const p = ctx.project?.project;
  if (p) {
    return [
      "## Project",
      `- This workflow is for the client project **${p.name}** (folder \`projects/${p.slug}/\`).`,
      `- Pass \`"project": "${p.slug}"\` in **every** tool call so data never mixes between clients.`,
    ].join("\n");
  }
  return [
    "## Project",
    ctx.projects.length
      ? `- No project is selected. Ask which client this is for (projects: ${ctx.projects.map((x) => x.name).join(", ")}), then pass \`project\` in every tool call — or call \`list_projects\`.`
      : "- No client project exists yet. Ask for the client's name and create it with `create_project` first.",
  ].join("\n");
}

/** Rules every workflow prompt shares (project, language, currency, facts vs judgment, honesty about data). */
export function houseRules(ctx: PromptCtx): string {
  const cfg = ctx.project?.business.tryLoad() ?? null;
  const lang = cfg ? languageName(cfg.business.language) : null;
  const lines = [
    "## House rules",
    cfg
      ? `- Business: **${cfg.business.name}** (${cfg.business.sector}, ${cfg.business.country}). Primary KPI: ${cfg.goals.primary_kpi}.`
      : "- This project has no business profile yet (business.yaml). Say so, use sensible defaults, and suggest the `setup_wizard` prompt for this project.",
    lang
      ? `- Write the final answer in **${lang}** (business.language = "${cfg!.business.language}"). Keep ad names, metric names and numbers exactly as the tools return them.`
      : "- Write in the user's language.",
    cfg
      ? `- Express money in **${cfg.business.currency}**.`
      : "- Express money in the account currency.",
    "- Clearly separate **Facts** (numbers and findings returned by tools — cite ad names and figures) from **Recommendations** (your judgment).",
    "- Never invent numbers. If a tool returns an error, missing data, a stale-data warning or thin data, say so plainly and continue with what is available.",
    '- Changing anything in Meta Ads Manager (new ads, pause/activate, budgets, duplicates) only ever happens through a `propose_*` tool → the user\'s explicit "yes" to that preview → `execute_ad_action`. Never execute on your own, never bundle several changes under one yes, and never say a change happened unless `execute_ad_action` returned status "executed". If managing ads is off for this project, give the steps for the user to do in Ads Manager instead.',
    "- Competitor rankings are estimates from observable signals, never real sales figures.",
    "- Be concrete and brief: bullet points and tables over long prose. Prioritise.",
  ];
  return lines.join("\n");
}

export function tomorrow(ctx: PromptCtx): string {
  return shiftDate(ctx.today(), 1);
}

export function assemble(title: string, body: string[], ctx: PromptCtx): string {
  return [
    `# ${title}`,
    `Today is ${ctx.today()}.`,
    "",
    projectRules(ctx),
    "",
    ...body,
    "",
    houseRules(ctx),
  ].join("\n");
}
