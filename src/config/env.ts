import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

export const envSchema = z.object({
  /** Folder that holds one sub-folder per client project. */
  PROJECTS_DIR: z.preprocess(emptyToUndefined, z.string().default("./projects")),
  META_ACCESS_TOKEN: optionalString,
  META_AD_ACCOUNT_ID: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().replace(/^act_/, "") || undefined : v),
    z.string().regex(/^\d+$/, "META_AD_ACCOUNT_ID must be numeric (without act_)").optional(),
  ),
  META_API_VERSION: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v21.0"),
  ),
  META_AD_LIBRARY_TOKEN: optionalString,
  /** Per project only: allow confirmed changes in Ads Manager (new ads, pause/activate, budgets). */
  META_WRITE_ENABLED: z.preprocess(
    (v) =>
      typeof v === "string"
        ? ["1", "true", "yes", "on"].includes(v.trim().toLowerCase())
        : (v ?? false),
    z.boolean(),
  ),
  /** Per project only: Facebook Page (and optional Instagram account) new ads are published from. */
  META_PAGE_ID: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d+$/, "META_PAGE_ID must be numeric").optional(),
  ),
  META_INSTAGRAM_USER_ID: z.preprocess(emptyToUndefined, z.string().regex(/^\d+$/).optional()),
  /** Per project only: highest daily budget (account currency, major units) a confirmed change may set. */
  META_MAX_DAILY_BUDGET: z.preprocess(emptyToUndefined, z.coerce.number().positive().optional()),
  WEB_USER_AGENT: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default("AIMarketingManagerBot/1.0 (+https://github.com/afnan-mahmud/ai-marketing-manager)"),
  ),
  WEB_TIMEOUT_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(15000)),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

/** Keys a project's own project.env may set (they override the global .env for that project). */
export const PROJECT_ENV_KEYS = [
  "META_ACCESS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "META_WRITE_ENABLED",
  "META_PAGE_ID",
  "META_INSTAGRAM_USER_ID",
  "META_MAX_DAILY_BUDGET",
  "META_API_VERSION",
  "META_AD_LIBRARY_TOKEN",
  "WEB_USER_AGENT",
  "WEB_TIMEOUT_MS",
] as const;

/**
 * Settings that identify or authorise a single client. They are read ONLY from that project's project.env and never
 * inherited from the global .env, so one client's account, Page or write permission can't leak into another project.
 */
export const PROJECT_ONLY_KEYS = [
  "META_AD_ACCOUNT_ID",
  "META_WRITE_ENABLED",
  "META_PAGE_ID",
  "META_INSTAGRAM_USER_ID",
  "META_MAX_DAILY_BUDGET",
] as const;

/** Env for one project: global values, overridden by the project's project.env (see PROJECT_ONLY_KEYS). */
export function loadProjectEnv(
  global: Record<string, string | undefined>,
  projectFile: Record<string, string | undefined>,
): Env {
  const merged: Record<string, string | undefined> = { ...global };
  for (const k of PROJECT_ONLY_KEYS) merged[k] = undefined;
  for (const k of PROJECT_ENV_KEYS)
    if (projectFile[k] !== undefined && projectFile[k] !== "") merged[k] = projectFile[k];
  return loadEnv(merged);
}
