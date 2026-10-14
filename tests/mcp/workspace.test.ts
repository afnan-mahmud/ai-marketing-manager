import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadProjectEnv } from "../../src/config/env.js";
import { createServer } from "../../src/server.js";
import type { Workspace } from "../../src/workspace.js";
import { EXAMPLE_YAML, SAMPLE_CSV, createTestWorkspace } from "../helpers/context.js";

async function connect(ws: Workspace) {
  const server = createServer(ws);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agency", version: "1" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0]!.text;
    if (!text.startsWith("{"))
      return { isError: r.isError === true, data: { type: "ProtocolError", error: text } };
    return { isError: r.isError === true, data: JSON.parse(text) };
  };
  return { client, call };
}

const BUSINESS = (name: string, competitor: string) => ({
  business: { name, sector: "skincare", country: "BD", currency: "BDT", language: "bn" },
  goals: { primary_kpi: "purchases", targets: { max_cpa: 400 } },
  competitors: [
    {
      name: competitor,
      website: `https://${competitor.toLowerCase().replace(/\s+/g, "-")}.example`,
    },
  ],
});

describe("agency workspace: one folder per client project", () => {
  it("creates a project folder with its own files and makes it active", async () => {
    const ws = createTestWorkspace();
    const { call } = await connect(ws);
    const r = await call("create_project", { name: "Acme Foods" });
    expect(r.isError).toBe(false);
    expect(r.data.project.slug).toBe("acme-foods");
    const dir = join(ws.projectsDir, "acme-foods");
    for (const f of [
      "project.json",
      "project.env",
      "inbox",
      "processed",
      "competitors",
      "snapshots",
      "reports",
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(readFileSync(join(dir, "project.env"), "utf8")).toContain("META_AD_ACCOUNT_ID=");
    expect(r.data.project.active).toBe(true);
    expect(r.data.project.business_profile).toBe("missing");
    expect(r.data.next_steps.join(" ")).toContain("setup_wizard");

    const dup = await call("create_project", { name: "acme foods" });
    expect(dup.isError).toBe(true);
    expect(dup.data.error).toContain("already exists");

    const status = await call("get_setup_status");
    expect(status.data.project).toEqual({ name: "Acme Foods", slug: "acme-foods" });
    expect(status.data.config.status).toBe("missing");
  });

  it("can create a project with its business profile in one call", async () => {
    const ws = createTestWorkspace();
    const { call } = await connect(ws);
    const r = await call("create_project", {
      name: "Glow BD",
      business: BUSINESS("Glow BD", "Rival"),
    });
    expect(r.isError).toBe(false);
    expect(r.data.project.business_profile).toBe("Glow BD — skincare, BD");
    expect(r.data.project.competitors).toBe(1);
    expect(existsSync(join(ws.projectsDir, "glow-bd", "business.yaml"))).toBe(true);
  });

  it("keeps data, competitors and reports separate per client", async () => {
    const ws = createTestWorkspace();
    const { call } = await connect(ws);
    const created = await call("create_project", {
      name: "Client A",
      business: BUSINESS("Brand A", "Rival A"),
    });
    expect(created.data.error ?? "").toBe("");
    await call("create_project", { name: "Client B", business: BUSINESS("Brand B", "Rival B") });

    copyFileSync(SAMPLE_CSV, join(ws.projectsDir, "client-a", "inbox", "export.csv"));
    const imp = await call("import_ads_from_folder", { project: "Client A" });
    expect(imp.data.totals.rows_upserted).toBe(333);
    expect(imp.data.project.slug).toBe("client-a");

    const a = await call("get_performance_summary", { project: "client-a", period: "last_7d" });
    expect(a.isError).toBe(false);
    const b = await call("get_performance_summary", { project: "client-b", period: "last_7d" });
    expect(b.isError).toBe(true);
    expect(b.data.type).toBe("NoDataError");

    const compA = await call("list_competitors", { project: "Client A" });
    const compB = await call("list_competitors", { project: "Client B" });
    expect(compA.data.competitors.map((c: { name: string }) => c.name)).toEqual(["Rival A"]);
    expect(compB.data.competitors.map((c: { name: string }) => c.name)).toEqual(["Rival B"]);

    await call("save_report", {
      project: "client-a",
      type: "daily_briefing",
      title: "A",
      markdown: "Report for A",
    });
    expect(
      existsSync(join(ws.projectsDir, "client-a", "reports", "2026-10-14-daily_briefing.md")),
    ).toBe(true);
    expect(
      existsSync(join(ws.projectsDir, "client-b", "reports", "2026-10-14-daily_briefing.md")),
    ).toBe(false);
    expect((await call("list_reports", { project: "client-b" })).data.reports).toEqual([]);
  });

  it("uses the active project when none is passed, and refuses to guess between several", async () => {
    const ws = createTestWorkspace();
    const { call } = await connect(ws);
    const none = await call("get_setup_status");
    expect(none.isError).toBe(true);
    expect(none.data.hint).toContain("create_project");

    await call("create_project", { name: "One" });
    await call("create_project", { name: "Two" });
    expect((await call("get_setup_status")).data.project.slug).toBe("two"); // newest is active
    await call("switch_project", { project: "One" });
    expect((await call("get_setup_status")).data.project.slug).toBe("one");
    const list = await call("list_projects");
    expect(list.data.active).toBe("one");
    expect(list.data.projects.map((p: { name: string }) => p.name)).toEqual(["One", "Two"]);

    writeFileSync(join(ws.projectsDir, ".active"), "");
    const ambiguous = await call("get_setup_status");
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.data.hint).toContain("One, Two");
    const unknown = await call("get_setup_status", { project: "Three" });
    expect(unknown.data.error).toContain('No project named "Three"');
  });

  it("gives each project its own Meta ad account; the global account id is never inherited", async () => {
    const urls: string[] = [];
    const ws = createTestWorkspace({
      env: { META_ACCESS_TOKEN: "agency-token", META_AD_ACCOUNT_ID: "999" },
      fetch: (async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    const { call } = await connect(ws);
    await call("create_project", { name: "Client A" });
    await call("create_project", { name: "Client B" });

    const notSet = await call("sync_ads_from_meta", { project: "Client A" });
    expect(notSet.isError).toBe(true);
    expect(notSet.data.hint).toContain("configure_project_meta");

    const conf = await call("configure_project_meta", {
      project: "Client A",
      ad_account_id: "act_111",
    });
    expect(conf.data.project.meta_api).toMatchObject({
      ad_account_id: "111",
      token: "set",
      manage_ads: false,
    });
    await call("configure_project_meta", { project: "Client B", ad_account_id: "222" });
    // Client B gets its own token via its project.env.
    const envB = join(ws.projectsDir, "client-b", "project.env");
    writeFileSync(
      envB,
      readFileSync(envB, "utf8").replace("META_ACCESS_TOKEN=", "META_ACCESS_TOKEN=client-b-token"),
    );

    await call("sync_ads_from_meta", { project: "Client A" });
    await call("sync_ads_from_meta", { project: "Client B" });
    const insights = urls.filter((u) => u.includes("/insights"));
    expect(insights[0]).toContain("/act_111/insights");
    expect(insights[0]).toContain("access_token=agency-token");
    expect(insights[1]).toContain("/act_222/insights");
    expect(insights[1]).toContain("access_token=client-b-token");
    expect(urls.some((u) => u.includes("act_999"))).toBe(false);
  });

  it("archives a project only with confirmation, without deleting it", async () => {
    const ws = createTestWorkspace();
    const { call } = await connect(ws);
    await call("create_project", { name: "Old Client" });
    const refused = await call("archive_project", { project: "Old Client" });
    expect(refused.isError).toBe(true);
    expect(refused.data.error).toContain("confirm");
    const r = await call("archive_project", { project: "Old Client", confirm: true });
    expect(r.isError).toBe(false);
    expect(existsSync(r.data.archived_to)).toBe(true);
    expect((await call("list_projects")).data.projects).toEqual([]);
  });

  it("prompts target a project explicitly; resources follow the active project", async () => {
    const ws = createTestWorkspace();
    const { client, call } = await connect(ws);
    await call("create_project", { name: "Acme" });
    copyFileSync(EXAMPLE_YAML, join(ws.projectsDir, "acme", "business.yaml"));
    await call("create_project", { name: "Other" });

    const p = await client.getPrompt({ name: "daily_briefing", arguments: { project: "Acme" } });
    const text = (p.messages[0]!.content as { text: string }).text;
    expect(text).toContain("client project **Acme**");
    expect(text).toContain('"project": "acme"');
    expect(text).toContain("Bengali");

    const wizard = await client.getPrompt({ name: "setup_wizard", arguments: { project: "Nope" } });
    expect((wizard.messages[0]!.content as { text: string }).text).toContain(
      "No project is selected",
    );

    await call("switch_project", { project: "acme" });
    const profile = await client.readResource({ uri: "marketing://business-profile" });
    expect(JSON.parse((profile.contents[0] as { text: string }).text).business.name).toBe(
      "My Brand",
    );
    const projects = await client.readResource({ uri: "marketing://projects" });
    expect(JSON.parse((projects.contents[0] as { text: string }).text).active).toBe("acme");
  });

  it("every project tool exposes the optional project argument", async () => {
    const ws = createTestWorkspace();
    const { client } = await connect(ws);
    const { tools } = await client.listTools();
    for (const t of tools) {
      if (
        [
          "create_project",
          "list_projects",
          "switch_project",
          "configure_project_meta",
          "archive_project",
        ].includes(t.name)
      )
        continue;
      expect(Object.keys(t.inputSchema.properties ?? {}), t.name).toContain("project");
    }
  });
});

describe("loadProjectEnv", () => {
  it("project values override global ones; the ad account is never global", () => {
    const env = loadProjectEnv(
      { META_ACCESS_TOKEN: "g", META_AD_ACCOUNT_ID: "1", META_API_VERSION: "v21.0" },
      { META_API_VERSION: "v22.0", META_ACCESS_TOKEN: "" },
    );
    expect(env.META_ACCESS_TOKEN).toBe("g");
    expect(env.META_AD_ACCOUNT_ID).toBeUndefined();
    expect(env.META_API_VERSION).toBe("v22.0");
  });
});
