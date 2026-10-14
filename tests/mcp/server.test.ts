import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";
import { createExampleProject, createTestWorkspace, importSample } from "../helpers/context.js";

async function connect(business?: "example") {
  const ws = createTestWorkspace();
  const ctx = business ? createExampleProject(ws) : ws.create("Empty Client").ctx;
  const server = createServer(ws);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { ctx, client, ws };
}

describe("MCP server surface", () => {
  it("lists tools with schemas and annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_setup_status",
        "import_ads_from_folder",
        "get_top_creatives",
        "save_report",
      ]),
    );
    const imp = tools.find((t) => t.name === "import_ads_from_folder")!;
    expect(imp.annotations?.readOnlyHint).toBe(false);
    const bd = tools.find((t) => t.name === "get_breakdown")!;
    expect(bd.inputSchema.required).toEqual(expect.arrayContaining(["period", "level"]));
  });

  it("calls a tool end to end over the protocol", async () => {
    const { client, ctx } = await connect("example");
    await importSample(ctx);
    const res = await client.callTool({
      name: "get_performance_summary",
      arguments: { period: "last_7d" },
    });
    const data = JSON.parse((res.content as { text: string }[])[0]!.text);
    expect(data.summary).toMatch(/^2026-10-07\.\.2026-10-13: spent BDT/);
  });

  it("serves prompts that follow the house rules", async () => {
    const { client } = await connect("example");
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        "ad_optimization_plan",
        "content_plan",
        "script_ideas",
        "sales_growth_ideas",
        "setup_wizard",
      ]),
    );
    const p = await client.getPrompt({ name: "content_plan", arguments: { days: "5" } });
    const text = (p.messages[0]!.content as { text: string }).text;
    expect(text).toContain("Plan 5 days");
    expect(text).toContain("starting 2026-10-15");
    expect(text).toContain("get_top_creatives");
    expect(text).toContain("Bengali");
    expect(text).toContain("BDT");
    expect(text).toContain("**Facts**");
  });

  it("serves resources", async () => {
    const { client } = await connect("example");
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "marketing://business-profile",
      "marketing://glossary",
      "marketing://playbook",
      "marketing://projects",
      "marketing://reports/latest",
    ]);
    const glossary = await client.readResource({ uri: "marketing://glossary" });
    expect((glossary.contents[0] as { text: string }).text).toContain("link_clicks / impressions");
    const playbook = await client.readResource({ uri: "marketing://playbook" });
    expect((playbook.contents[0] as { text: string }).text).toContain("Creative fatigue");
    const profile = await client.readResource({ uri: "marketing://business-profile" });
    expect(JSON.parse((profile.contents[0] as { text: string }).text).business.name).toBe(
      "My Brand",
    );
    const latest = await client.readResource({ uri: "marketing://reports/latest" });
    expect((latest.contents[0] as { text: string }).text).toContain("No daily briefing");
  });
});
