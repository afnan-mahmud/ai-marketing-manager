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
  "META_API_VERSION",
  "META_AD_LIBRARY_TOKEN",
  "WEB_USER_AGENT",
  "WEB_TIMEOUT_MS",
] as const;

/**
 * Env for one project: global values, overridden by the project's project.env.
 * META_AD_ACCOUNT_ID is never inherited from the global env — each client's ad account must be set in its own
 * project, so one client's data can never be synced into another client's project by accident.
 */
export function loadProjectEnv(
  global: Record<string, string | undefined>,
  projectFile: Record<string, string | undefined>,
): Env {
  const merged: Record<string, string | undefined> = { ...global, META_AD_ACCOUNT_ID: undefined };
  for (const k of PROJECT_ENV_KEYS)
    if (projectFile[k] !== undefined && projectFile[k] !== "") merged[k] = projectFile[k];
  return loadEnv(merged);
}
