import { z } from "zod";
import type { AppContext } from "../../context.js";
import { shiftDate } from "../../utils/dates.js";

export type PromptArgs = Record<string, string | undefined>;

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** MCP prompt arguments are always optional strings. */
  argsSchema: Record<string, z.ZodOptional<z.ZodString>>;
  build: (args: PromptArgs, ctx: AppContext) => string;
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

/** Rules every workflow prompt shares (language, currency, facts vs judgment, honesty about data). */
export function houseRules(ctx: AppContext): string {
  const cfg = ctx.business.tryLoad();
  const lang = cfg ? languageName(cfg.business.language) : null;
  const lines = [
    "## House rules",
    cfg
      ? `- Business: **${cfg.business.name}** (${cfg.business.sector}, ${cfg.business.country}). Primary KPI: ${cfg.goals.primary_kpi}.`
      : "- No business profile exists yet (config/business.yaml). Say so, use sensible defaults, and suggest the `setup_wizard` prompt.",
    lang
      ? `- Write the final answer in **${lang}** (business.language = "${cfg!.business.language}"). Keep ad names, metric names and numbers exactly as the tools return them.`
      : "- Write in the user's language.",
    cfg
      ? `- Express money in **${cfg.business.currency}**.`
      : "- Express money in the account currency.",
    "- Clearly separate **Facts** (numbers and findings returned by tools — cite ad names and figures) from **Recommendations** (your judgment).",
    "- Never invent numbers. If a tool returns an error, missing data, a stale-data warning or thin data, say so plainly and continue with what is available.",
    "- This server is read-only toward Meta: recommend actions for the user to take in Ads Manager; never claim you changed anything.",
    "- Competitor rankings are estimates from observable signals, never real sales figures.",
    "- Be concrete and brief: bullet points and tables over long prose. Prioritise.",
  ];
  return lines.join("\n");
}

export function tomorrow(ctx: AppContext): string {
  return shiftDate(ctx.today(), 1);
}

export function assemble(title: string, body: string[], ctx: AppContext): string {
  return [`# ${title}`, `Today is ${ctx.today()}.`, "", ...body, "", houseRules(ctx)].join("\n");
}
