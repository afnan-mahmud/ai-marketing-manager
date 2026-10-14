import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

export const envSchema = z.object({
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().default("./data")),
  BUSINESS_CONFIG: z.preprocess(emptyToUndefined, z.string().default("./config/business.yaml")),
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
