import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContext } from "../../context.js";
import type { Workspace } from "../../workspace.js";
import { renderGlossary } from "./glossary.js";

export interface ResourceDef {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: "application/json" | "text/markdown";
  /** "project" resources read the active project; "workspace" resources read the whole workspace. */
  scope?: "workspace";
  read: (ctx: AppContext) => string;
  readWorkspace?: (ws: Workspace) => string;
}

const PLAYBOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), "playbook.md");

export const allResources: ResourceDef[] = [
  {
    name: "projects",
    uri: "marketing://projects",
    title: "Client projects",
    description: "All client projects in the workspace and which one is active.",
    mimeType: "application/json",
    scope: "workspace",
    read: () => "",
    readWorkspace: (ws) =>
      JSON.stringify(
        {
          active: ws.activeSlug(),
          projects: ws.list().map(({ name, slug, created_at }) => ({ name, slug, created_at })),
        },
        null,
        2,
      ),
  },
  {
    name: "business-profile",
    uri: "marketing://business-profile",
    title: "Business profile",
    description: "The active project's business.yaml as JSON (or the reason it can't be loaded).",
    mimeType: "application/json",
    read: (ctx) => {
      const r = ctx.business.load();
      return JSON.stringify(
        r.status === "ok"
          ? r.config
          : r.status === "missing"
            ? {
                project: ctx.project.name,
                error: "business.yaml not found for this project",
                hint: "Run the setup_wizard prompt.",
              }
            : { project: ctx.project.name, error: "business.yaml is invalid", issues: r.issues },
        null,
        2,
      );
    },
  },
  {
    name: "latest-report",
    uri: "marketing://reports/latest",
    title: "Latest daily briefing",
    description: "The active project's most recent saved daily briefing (Markdown).",
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
