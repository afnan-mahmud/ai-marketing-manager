import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../../src/config/env.js";
import { createContext, type AppContext } from "../../src/context.js";
import { PROJECT_ROOT } from "../../src/config/paths.js";

export const TEST_NOW = new Date("2026-10-14T09:00:00");
export const SAMPLE_CSV = join(PROJECT_ROOT, "examples", "sample-meta-export.csv");
export const EXAMPLE_YAML = join(PROJECT_ROOT, "config", "business.example.yaml");

export interface TestContextOptions {
  /** "example" copies business.example.yaml; a string writes that YAML; undefined = no config. */
  business?: "example" | string;
  env?: Record<string, string>;
  fetch?: typeof fetch;
  now?: Date;
}

export function createTestContext(opts: TestContextOptions = {}): AppContext & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "amm-test-"));
  const dataDir = join(root, "data");
  for (const d of ["inbox", "processed", "competitors", "snapshots", "reports"]) {
    mkdirSync(join(dataDir, d), { recursive: true });
  }
  const configPath = join(root, "business.yaml");
  if (opts.business === "example") copyFileSync(EXAMPLE_YAML, configPath);
  else if (typeof opts.business === "string") writeFileSync(configPath, opts.business);
  const env = loadEnv({ DATA_DIR: dataDir, BUSINESS_CONFIG: configPath, ...opts.env });
  const now = opts.now ?? TEST_NOW;
  const ctx = createContext({
    env,
    dbFile: ":memory:",
    now: () => now,
    fetch:
      opts.fetch ??
      (async () => {
        throw new Error("network disabled in tests");
      }),
    sleep: async () => {},
  });
  return Object.assign(ctx, { root });
}

/** Copies the sample export into the inbox and imports it. */
export function importSample(ctx: AppContext): void {
  copyFileSync(SAMPLE_CSV, join(ctx.paths.inbox, "sample.csv"));
  const r = ctx.services.ads.importFromFolder(false);
  if (r.totals.rows_upserted === 0) throw new Error("sample import failed");
}
