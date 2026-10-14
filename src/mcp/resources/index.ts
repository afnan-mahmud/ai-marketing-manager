import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContext } from "../../context.js";
import { renderGlossary } from "./glossary.js";

export interface ResourceDef {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: "application/json" | "text/markdown";
  read: (ctx: AppContext) => string;
}

const PLAYBOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), "playbook.md");

export const allResources: ResourceDef[] = [
  {
    name: "business-profile",
    uri: "marketing://business-profile",
    title: "Business profile",
    description: "config/business.yaml as JSON (or the reason it can't be loaded).",
    mimeType: "application/json",
    read: (ctx) => {
      const r = ctx.business.load();
      return JSON.stringify(
        r.status === "ok"
          ? r.config
          : r.status === "missing"
            ? { error: "config/business.yaml not found", hint: "Run the setup_wizard prompt." }
            : { error: "config/business.yaml is invalid", issues: r.issues },
        null,
        2,
      );
    },
  },
  {
    name: "latest-report",
    uri: "marketing://reports/latest",
    title: "Latest daily briefing",
    description: "The most recent saved daily briefing (Markdown).",
    mimeType: "text/markdown",
    read: (ctx) =>
      ctx.services.reports.latestMarkdown("daily_briefing")?.markdown ??
      "_No daily briefing saved yet. Run the daily_briefing prompt._\n",
  },
  {
    name: "glossary",
    uri: "marketing://glossary",
    title: "Metric glossary",
    description: "Definitions and formulas of every metric, verdict rules and benchmarks.",
    mimeType: "text/markdown",
    read: () => renderGlossary(),
  },
  {
    name: "playbook",
    uri: "marketing://playbook",
    title: "Meta Ads playbook",
    description:
      "Best practices for hooks, testing, fatigue, budget and funnel fixes (community-editable).",
    mimeType: "text/markdown",
    read: () => readFileSync(PLAYBOOK_PATH, "utf8"),
  },
];
