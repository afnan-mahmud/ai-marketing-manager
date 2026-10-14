import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../../src/config/env.js";
import { PROJECT_ROOT } from "../../src/config/paths.js";
import { createContext, type AppContext } from "../../src/context.js";
import { Workspace } from "../../src/workspace.js";

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

const noNetwork = (async () => {
  throw new Error("network disabled in tests");
}) as typeof fetch;

/** A single project context in a temp folder with an in-memory database. */
export function createTestContext(opts: TestContextOptions = {}): AppContext & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "amm-test-"));
  for (const d of ["inbox", "processed", "competitors", "snapshots", "reports"]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  const configPath = join(root, "business.yaml");
  if (opts.business === "example") copyFileSync(EXAMPLE_YAML, configPath);
  else if (typeof opts.business === "string") writeFileSync(configPath, opts.business);
  const now = opts.now ?? TEST_NOW;
  const ctx = createContext({
    project: {
      name: "Test Project",
      slug: "test-project",
      dir: root,
      created_at: TEST_NOW.toISOString(),
    },
    env: loadEnv({ ...opts.env }),
    dbFile: ":memory:",
    now: () => now,
    fetch: opts.fetch ?? noNetwork,
    sleep: async () => {},
  });
  return Object.assign(ctx, { root });
}

/** A temp agency workspace (projects/ folder) with in-memory databases. */
export function createTestWorkspace(
  opts: { env?: Record<string, string>; fetch?: typeof fetch; now?: Date } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "amm-ws-"));
  const now = opts.now ?? TEST_NOW;
  return new Workspace({
    projectsDir: join(root, "projects"),
    globalEnv: { ...opts.env },
    now: () => now,
    fetch: opts.fetch ?? noNetwork,
    sleep: async () => {},
    inMemoryDb: true,
  });
}

/** Creates a project in `ws` with the example business profile. */
export function createExampleProject(ws: Workspace, name = "My Brand"): AppContext {
  const { ctx } = ws.create(name);
  copyFileSync(EXAMPLE_YAML, ctx.business.path);
  return ctx;
}

/** Copies the sample export into the inbox and imports it. */
export async function importSample(ctx: AppContext): Promise<void> {
  copyFileSync(SAMPLE_CSV, join(ctx.paths.inbox, "sample.csv"));
  const r = await ctx.services.ads.importFromFolder(false);
  if (r.totals.rows_upserted === 0) throw new Error("sample import failed");
}
