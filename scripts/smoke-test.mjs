// Starts dist/index.js over stdio with a temp projects dir, creates a client project, imports the sample export
// into it and runs a few tools.
// Used in CI and handy after a fresh clone: `npm run build && node scripts/smoke-test.mjs`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectsDir = join(mkdtempSync(join(tmpdir(), "amm-smoke-")), "projects");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, PROJECTS_DIR: projectsDir, LOG_LEVEL: "warn" },
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const data = JSON.parse(res.content[0].text);
  if (res.isError) throw new Error(`${name} failed: ${JSON.stringify(data)}`);
  process.stderr.write(`✓ ${name}: ${data.summary}\n`);
  return data;
};

const { tools } = await client.listTools();
const { prompts } = await client.listPrompts();
process.stderr.write(`Server exposes ${tools.length} tools and ${prompts.length} prompts.\n`);
const created = await call("create_project", { name: "Smoke Client" });
const dir = created.project.path;
copyFileSync(join(root, "config", "business.example.yaml"), join(dir, "business.yaml"));
copyFileSync(join(root, "examples", "sample-meta-export.csv"), join(dir, "inbox", "sample.csv"));
await call("import_ads_from_folder", { project: "Smoke Client" });
await call("get_setup_status");
await call("get_performance_summary", { period: { since: "2026-10-07", until: "2026-10-13" } });
const wl = await call("get_winners_and_losers", {
  period: { since: "2026-09-14", until: "2026-10-13" },
});
if (wl.counts.winner < 1 || wl.counts.fatigued < 1)
  throw new Error("unexpected verdicts on sample data");
await client.close();
process.stderr.write("Smoke test passed.\n");
