import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ConfigInvalidError, ConfigMissingError } from "../utils/errors.js";

export const primaryKpis = ["purchases", "leads", "messages", "link_clicks"] as const;
export type PrimaryKpi = (typeof primaryKpis)[number];

const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative().optional(),
  margin_pct: z.number().min(0).max(100).optional(),
});

const competitorSchema = z.object({
  name: z.string().min(1),
  website: z.string().url().optional().or(z.literal("")),
  facebook_page_id: z.string().optional(),
  notes: z.string().optional(),
  extra_urls: z.array(z.string().url()).optional(),
});

export const positioningWeightsSchema = z.object({
  active_ad_count: z.number().min(0).default(1),
  ad_longevity: z.number().min(0).default(1),
  creative_velocity: z.number().min(0).default(1),
  offer_aggressiveness: z.number().min(0).default(1),
  social_proof: z.number().min(0).default(1),
  social_following: z.number().min(0).default(1),
  web_traffic: z.number().min(0).default(1),
  price_position: z.number().min(0).default(0.5),
});

export const businessConfigSchema = z.object({
  business: z.object({
    name: z.string().min(1),
    sector: z.string().min(1),
    country: z.string().length(2, "Use a 2-letter ISO country code, e.g. BD"),
    currency: z.string().min(3).max(3),
    language: z.string().default("en"),
    website: z.string().url().optional().or(z.literal("")),
    extra_urls: z.array(z.string().url()).optional(),
    products: z.array(productSchema).default([]),
    target_audience: z.string().optional(),
    brand_voice: z.string().optional(),
  }),
  goals: z
    .object({
      primary_kpi: z.enum(primaryKpis).default("purchases"),
      targets: z
        .object({
          max_cpa: z.number().positive().optional(),
          min_roas: z.number().positive().optional(),
          min_ctr_pct: z.number().positive().optional(),
        })
        .default({}),
      monthly_budget: z.number().nonnegative().optional(),
    })
    .default({ primary_kpi: "purchases", targets: {} }),
  classification: z
    .object({
      min_spend_for_verdict: z.number().nonnegative().default(1000),
      min_impressions_for_verdict: z.number().int().nonnegative().default(3000),
      fatigue_frequency: z.number().positive().default(3.0),
    })
    .default({
      min_spend_for_verdict: 1000,
      min_impressions_for_verdict: 3000,
      fatigue_frequency: 3,
    }),
  competitors: z.array(competitorSchema).default([]),
  positioning: z
    .object({ weights: positioningWeightsSchema.default(positioningWeightsSchema.parse({})) })
    .default({ weights: positioningWeightsSchema.parse({}) }),
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;
export type CompetitorConfig = z.infer<typeof competitorSchema>;
export type PositioningWeights = z.infer<typeof positioningWeightsSchema>;

/** Classification/goal defaults used when no business.yaml exists, so analytics still works. */
export const defaultAnalysisSettings = {
  primary_kpi: "purchases" as PrimaryKpi,
  targets: {} as BusinessConfig["goals"]["targets"],
  classification: {
    min_spend_for_verdict: 1000,
    min_impressions_for_verdict: 3000,
    fatigue_frequency: 3,
  },
};

/** Patch shape accepted by update_business_profile (every field optional; arrays replace wholesale). */
export const businessPatchSchema = z.object({
  business: businessConfigSchema.shape.business.partial().optional(),
  goals: z
    .object({
      primary_kpi: z.enum(primaryKpis).optional(),
      targets: z
        .object({
          max_cpa: z.number().positive().nullable().optional(),
          min_roas: z.number().positive().nullable().optional(),
          min_ctr_pct: z.number().positive().nullable().optional(),
        })
        .optional(),
      monthly_budget: z.number().nonnegative().nullable().optional(),
    })
    .optional(),
  classification: z
    .object({
      min_spend_for_verdict: z.number().nonnegative().optional(),
      min_impressions_for_verdict: z.number().int().nonnegative().optional(),
      fatigue_frequency: z.number().positive().optional(),
    })
    .optional(),
  competitors: z.array(competitorSchema).optional(),
  positioning: z.object({ weights: positioningWeightsSchema.partial().optional() }).optional(),
});
export type BusinessPatch = z.infer<typeof businessPatchSchema>;

export type LoadResult =
  | { status: "ok"; config: BusinessConfig }
  | { status: "missing" }
  | { status: "invalid"; issues: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Reads and validates business.yaml. Re-read on every call so manual edits apply immediately. */
export class BusinessStore {
  constructor(public readonly path: string) {}

  load(): LoadResult {
    if (!existsSync(this.path)) return { status: "missing" };
    let raw: unknown;
    try {
      raw = YAML.parse(readFileSync(this.path, "utf8"));
    } catch (e) {
      return { status: "invalid", issues: [`YAML syntax error: ${(e as Error).message}`] };
    }
    const parsed = businessConfigSchema.safeParse(raw ?? {});
    if (!parsed.success) return { status: "invalid", issues: formatIssues(parsed.error) };
    return { status: "ok", config: parsed.data };
  }

  /** Returns the config or throws a friendly typed error. */
  require(): BusinessConfig {
    const r = this.load();
    if (r.status === "missing") throw new ConfigMissingError();
    if (r.status === "invalid") throw new ConfigInvalidError(r.issues);
    return r.config;
  }

  /** Returns the config or null (for tools that work with defaults). */
  tryLoad(): BusinessConfig | null {
    const r = this.load();
    return r.status === "ok" ? r.config : null;
  }

  /**
   * Applies a partial patch, preserving comments/formatting in the existing YAML where possible.
   * Objects merge key by key; arrays and scalars replace; null deletes the key.
   */
  update(patch: BusinessPatch): BusinessConfig {
    const exists = existsSync(this.path);
    const doc = exists
      ? YAML.parseDocument(readFileSync(this.path, "utf8"))
      : new YAML.Document({});
    if (exists && doc.errors.length > 0) {
      throw new ConfigInvalidError(doc.errors.map((e) => `YAML syntax error: ${e.message}`));
    }
    applyPatch(doc, [], patch as Record<string, unknown>);
    const parsed = businessConfigSchema.safeParse(doc.toJS() ?? {});
    if (!parsed.success) throw new ConfigInvalidError(formatIssues(parsed.error));
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, doc.toString(), "utf8");
    return parsed.data;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function applyPatch(doc: YAML.Document, path: string[], value: Record<string, unknown>): void {
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const p = [...path, key];
    if (v === null) {
      doc.deleteIn(p);
    } else if (isPlainObject(v)) {
      if (!(doc.getIn(p, true) instanceof YAML.YAMLMap)) doc.setIn(p, doc.createNode({}));
      applyPatch(doc, p, v);
    } else {
      doc.setIn(p, doc.createNode(v));
    }
  }
}
