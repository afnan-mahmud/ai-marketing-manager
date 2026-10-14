import { relative } from "node:path";
import { z } from "zod";
import { businessPatchSchema } from "../../config/business.js";
import { PROJECT_ROOT } from "../../config/paths.js";
import type { Workspace } from "../../workspace.js";
import type { AnyWorkspaceToolDef } from "../tooling.js";
import { defineWorkspaceTool } from "../tooling.js";

function describeProject(ws: Workspace, slug: string) {
  const ctx = ws.context(slug);
  const cfg = ctx.business.load();
  return {
    name: ctx.project.name,
    slug: ctx.project.slug,
    folder: relative(PROJECT_ROOT, ctx.project.dir).startsWith("..")
      ? ctx.project.dir
      : relative(PROJECT_ROOT, ctx.project.dir),
    path: ctx.project.dir,
    created_at: ctx.project.created_at,
    active: ws.activeSlug() === slug,
    business_profile:
      cfg.status === "ok"
        ? `${cfg.config.business.name} — ${cfg.config.business.sector}, ${cfg.config.business.country}`
        : cfg.status,
    competitors: cfg.status === "ok" ? cfg.config.competitors.length : 0,
    meta_api: {
      ad_account_id: ctx.env.META_AD_ACCOUNT_ID ?? null,
      token: ctx.env.META_ACCESS_TOKEN ? "set" : "missing",
      manage_ads: ctx.env.META_WRITE_ENABLED,
      page_id: ctx.env.META_PAGE_ID ?? null,
      instagram_user_id: ctx.env.META_INSTAGRAM_USER_ID ?? null,
      max_daily_budget: ctx.env.META_MAX_DAILY_BUDGET ?? null,
    },
    data_last_date: ctx.repos.ads.lastDate(),
  };
}

export const createProject = defineWorkspaceTool({
  name: "create_project",
  title: "Create client project",
  description:
    'Creates a new client project: a folder projects/<name>/ with its own business profile, competitor list, Meta API settings (project.env), ad database, inbox, snapshots and reports — fully separate from other clients. Use when the user says e.g. "create a project called Acme". The new project becomes the active one. Pass `business` if the client\'s details are known (name, sector, country, currency, …); otherwise follow up with the setup_wizard prompt for this project.',
  inputSchema: {
    name: z
      .string()
      .min(1)
      .max(80)
      .describe("Client / project name; the folder name is derived from it."),
    business: businessPatchSchema
      .optional()
      .describe("Optional initial business profile (same shape as update_business_profile)."),
  },
  readOnly: false,
  handler: (args, ws) => {
    const { project } = ws.create(args.name, args.business);
    return {
      summary: `Created project "${project.name}" in projects/${project.slug}/ and made it the active project.`,
      project: describeProject(ws, project.slug),
      next_steps: [
        ...(args.business
          ? []
          : [
              `Run the setup_wizard prompt with project "${project.slug}" to fill in the client's business profile and competitors.`,
            ]),
        `Put this client's Ads Manager exports in projects/${project.slug}/inbox/, or set its ad account with configure_project_meta.`,
        `Pass project: "${project.slug}" in tool calls for this client.`,
      ],
    };
  },
});

export const listProjects = defineWorkspaceTool({
  name: "list_projects",
  title: "List client projects",
  description:
    "All client projects in the workspace with their folder, business profile status, Meta API status, latest data date and which one is active.",
  inputSchema: {},
  handler: (_a, ws) => {
    const projects = ws.list().map((p) => describeProject(ws, p.slug));
    const active =
      projects.find((p) => p.active) ?? (projects.length === 1 ? projects[0] : undefined);
    return {
      summary: projects.length
        ? `${projects.length} project(s); active: ${active?.name ?? "none (pass project to tools or call switch_project)"}.`
        : "No projects yet. Create one with create_project.",
      projects_dir: ws.projectsDir,
      active: active?.slug ?? null,
      projects,
    };
  },
});

export const switchProject = defineWorkspaceTool({
  name: "switch_project",
  title: "Switch active project",
  description:
    "Makes a project the active one, used by tools called without a `project` argument. Prefer passing `project` explicitly when several clients are discussed.",
  inputSchema: { project: z.string().min(1).describe("Project name or folder.") },
  readOnly: false,
  handler: (args, ws) => {
    const p = ws.resolve(args.project);
    ws.setActive(p.slug);
    return { summary: `Active project is now "${p.name}".`, project: describeProject(ws, p.slug) };
  },
});

export const configureProjectMeta = defineWorkspaceTool({
  name: "configure_project_meta",
  title: "Configure project Meta settings",
  description:
    "Sets this client's Meta settings in projects/<name>/project.env: ad account id, API version, the Facebook Page / Instagram account new ads are published from, a daily-budget safety cap, and whether Claude may prepare Ads Manager changes (write_enabled — set it only when the user explicitly asks; every change still needs their confirmation). Tokens are not accepted here so they don't end up in chat history: the agency token comes from the global .env, or put a client-specific META_ACCESS_TOKEN in the project's project.env yourself.",
  inputSchema: {
    project: z.string().min(1).optional(),
    ad_account_id: z
      .string()
      .regex(/^(act_)?\d+$/, "numeric ad account id, e.g. 123456789")
      .optional(),
    api_version: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .optional(),
    page_id: z.string().regex(/^\d+$/, "numeric Facebook Page id").optional(),
    instagram_user_id: z.string().regex(/^\d+$/).optional(),
    max_daily_budget: z
      .number()
      .positive()
      .optional()
      .describe("Highest daily budget a confirmed change may set (account currency)."),
    write_enabled: z
      .boolean()
      .optional()
      .describe("Allow preparing Ads Manager changes for this client (only if the user asks)."),
  },
  readOnly: false,
  handler: (args, ws) => {
    const p = ws.configureMeta(args.project, {
      META_AD_ACCOUNT_ID: args.ad_account_id?.replace(/^act_/, ""),
      META_API_VERSION: args.api_version,
      META_PAGE_ID: args.page_id,
      META_INSTAGRAM_USER_ID: args.instagram_user_id,
      META_MAX_DAILY_BUDGET: args.max_daily_budget?.toString(),
      META_WRITE_ENABLED: args.write_enabled === undefined ? undefined : String(args.write_enabled),
    });
    const info = describeProject(ws, p.slug);
    const hints: string[] = [];
    if (info.meta_api.token === "missing")
      hints.push(
        `Add META_ACCESS_TOKEN to the global .env, or to ${p.dir}/project.env for this client only.`,
      );
    if (info.meta_api.manage_ads) {
      hints.push(
        "Managing ads needs a token with ads_management (not only ads_read), and the system user needs access to the Page for new ads.",
      );
      if (!info.meta_api.page_id) hints.push("Set page_id so new ads can be created.");
      if (!info.meta_api.max_daily_budget) hints.push("Consider a max_daily_budget safety cap.");
    }
    return {
      summary: `Updated Meta settings for "${p.name}" (ad account ${info.meta_api.ad_account_id ?? "not set"}, token ${info.meta_api.token}, managing ads ${info.meta_api.manage_ads ? "ON — every change needs confirmation" : "off"}).`,
      project: info,
      ...(hints.length ? { hints } : {}),
    };
  },
});

export const archiveProject = defineWorkspaceTool({
  name: "archive_project",
  title: "Archive project",
  description:
    "Moves a client project folder to projects/_archived/ (nothing is deleted). Requires confirm: true — ask the user first.",
  inputSchema: {
    project: z.string().min(1),
    confirm: z.literal(true).describe("Must be true; confirm with the user first."),
  },
  readOnly: false,
  handler: (args, ws) => {
    const r = ws.archive(args.project);
    return {
      summary: `Archived "${r.project.name}" to ${r.archived_to}.`,
      archived_to: r.archived_to,
    };
  },
});

export const workspaceTools: AnyWorkspaceToolDef[] = [
  createProject,
  listProjects,
  switchProject,
  configureProjectMeta,
  archiveProject,
];
