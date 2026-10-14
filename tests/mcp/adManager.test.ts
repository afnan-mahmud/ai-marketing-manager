import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { AppContext, ConfirmDecision } from "../../src/context.js";
import { createServer } from "../../src/server.js";
import { Workspace } from "../../src/workspace.js";
import { TEST_NOW } from "../helpers/context.js";
import { call } from "./performanceTools.test.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

interface Post {
  path: string;
  body: Record<string, string>;
  files: string[];
}

/** In-memory Graph API: account 111 (BDT) owns campaign 401, ad set 501, ad 601; ad set 999 belongs to account 222. */
function fakeGraph(opts: { videoProcessingPolls?: number; failCreative?: boolean } = {}) {
  const posts: Post[] = [];
  const objects: Record<string, Record<string, unknown>> = {
    "401": {
      id: "401",
      account_id: "111",
      name: "Serum | Sales",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      daily_budget: "300000",
      objective: "OUTCOME_SALES",
    },
    "501": {
      id: "501",
      account_id: "111",
      name: "Women 20-35 | Dhaka",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      daily_budget: "100000",
      optimization_goal: "OFFSITE_CONVERSIONS",
      campaign: { id: "401", name: "Serum | Sales", objective: "OUTCOME_SALES" },
    },
    "601": {
      id: "601",
      account_id: "111",
      name: "UGC Review",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      adset_id: "501",
      campaign_id: "401",
    },
    "999": {
      id: "999",
      account_id: "222",
      name: "Other client's ad set",
      status: "ACTIVE",
      daily_budget: "50000",
    },
  };
  let videoPolls = 0;
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    if (init?.method === "POST") {
      const body: Record<string, string> = {};
      const files: string[] = [];
      if (init.body instanceof FormData) {
        for (const [k, v] of init.body.entries()) {
          if (typeof v === "string") body[k] = v;
          else files.push(`${k}:${(v as File).name}`);
        }
      } else if (init.body instanceof URLSearchParams) for (const [k, v] of init.body) body[k] = v;
      posts.push({ path, body, files });
      if (path === "act_111/adimages")
        return json({ images: { "photo.jpg": { hash: "HASH123", url: "https://img" } } });
      if (path === "act_111/advideos") return json({ id: "VID9" });
      if (path === "act_111/adcreatives")
        return opts.failCreative
          ? json({ error: { message: "Invalid page", code: 100 } }, 400)
          : json({ id: "CR7" });
      if (path === "act_111/ads") return json({ id: "AD8" });
      if (path.endsWith("/copies"))
        return json({ copied_ad_id: "AD-COPY", copied_adset_id: "AS-COPY" });
      if (path === "AS-COPY" || path === "AD-COPY") return json({ success: true });
      const target = objects[path];
      if (target) {
        Object.assign(target, body);
        return json({ success: true });
      }
      return json({ error: { message: "unknown", code: 100 } }, 400);
    }
    if (path === "act_111") return json({ id: "act_111", account_id: "111", currency: "BDT" });
    if (path === "act_111/campaigns") return json({ data: [objects["401"]] });
    if (path === "act_111/adsets")
      return json({ data: [{ ...objects["501"], campaign_id: "401" }] });
    if (path === "act_111/ads") return json({ data: [objects["601"]] });
    if (path === "VID9")
      return json({
        status: {
          video_status: ++videoPolls > (opts.videoProcessingPolls ?? 0) ? "ready" : "processing",
        },
      });
    if (path === "VID9/thumbnails")
      return json({
        data: [{ uri: "https://thumb/1" }, { uri: "https://thumb/2", is_preferred: true }],
      });
    if (objects[path]) return json(objects[path]);
    return json({ error: { message: `Unsupported get request ${path}`, code: 100 } }, 400);
  }) as typeof fetch;
  return { fetchImpl, posts, objects };
}

function setup(
  opts: {
    write?: boolean;
    cap?: number;
    confirm?: ConfirmDecision;
    graph?: Parameters<typeof fakeGraph>[0];
    now?: () => Date;
  } = {},
) {
  const graph = fakeGraph(opts.graph);
  let now = opts.now ?? (() => TEST_NOW);
  const decisions: string[] = [];
  const ws = new Workspace({
    projectsDir: join(mkdtempSync(join(tmpdir(), "amm-ads-")), "projects"),
    globalEnv: { META_ACCESS_TOKEN: "agency-token" },
    now: () => now(),
    fetch: graph.fetchImpl,
    sleep: async () => {},
    inMemoryDb: true,
    confirm: async (req) => {
      decisions.push(req.message);
      return opts.confirm ?? "accepted";
    },
  });
  ws.create("Glow BD");
  ws.configureMeta("glow-bd", {
    META_AD_ACCOUNT_ID: "111",
    META_PAGE_ID: "7777",
    META_WRITE_ENABLED: String(opts.write ?? true),
    ...(opts.cap ? { META_MAX_DAILY_BUDGET: String(opts.cap) } : {}),
  });
  const ctx: AppContext = ws.context("glow-bd");
  mkdirSync(join(ctx.paths.creatives, "october"), { recursive: true });
  writeFileSync(
    join(ctx.paths.creatives, "october", "photo.jpg"),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  );
  writeFileSync(join(ctx.paths.creatives, "reel.mp4"), Buffer.alloc(2048));
  writeFileSync(join(ctx.paths.creatives, "notes.txt"), "ignore me");
  return { ws, ctx, ...graph, decisions, setNow: (d: Date) => (now = () => d) };
}

const NEW_AD = {
  file: "october/photo.jpg",
  adset_id: "501",
  ad_name: "Oct - Glow photo",
  primary_text: "Bright skin in 28 days. Cash on delivery.",
  headline: "Vitamin C Serum",
  cta: "SHOP_NOW",
  link_url: "https://mybrand.com/serum",
  status: "PAUSED",
};

describe("managing ads (propose → confirm → execute)", () => {
  it("is off by default: proposals are refused with how to enable it", async () => {
    const { ctx, posts } = setup({ write: false });
    const r = await call(ctx, "propose_new_ad", NEW_AD);
    expect(r.isError).toBe(true);
    expect(r.data.error).toContain("turned off");
    expect(r.data.hint).toContain("write_enabled");
    expect(posts).toEqual([]);
    // Reading the live structure works without write access.
    const s = await call(ctx, "get_meta_structure", { include_ads: true });
    expect(s.data.campaigns[0].adsets[0]).toMatchObject({ id: "501", daily_budget: 1000 });
    expect(s.data.ads[0].id).toBe("601");
  });

  it("lists creative files from the project's creatives folder", async () => {
    const { ctx } = setup();
    const r = await call(ctx, "list_creative_files");
    expect(
      r.data.files.map((f: { file: string; type: string }) => `${f.file}:${f.type}`).sort(),
    ).toEqual(["october/photo.jpg:image", "reel.mp4:video"]);
  });

  it("creates an image ad only after confirmation; the proposal itself changes nothing", async () => {
    const { ctx, posts, decisions } = setup();
    const proposal = await call(ctx, "propose_new_ad", NEW_AD);
    expect(proposal.isError).toBe(false);
    expect(posts).toEqual([]);
    expect(proposal.data.preview.ad_set).toMatchObject({
      id: "501",
      name: "Women 20-35 | Dhaka",
      daily_budget: "BDT 1,000",
    });
    expect(proposal.data.preview.initial_status).toBe("PAUSED");
    expect(proposal.data.next_step).toContain("execute_ad_action");

    const done = await call(ctx, "execute_ad_action", { action_id: proposal.data.action_id });
    expect(done.isError).toBe(false);
    expect(done.data).toMatchObject({
      status: "executed",
      confirmed_via: "elicitation",
      result: { image_hash: "HASH123", creative_id: "CR7", ad_id: "AD8" },
    });
    expect(decisions[0]).toContain("Glow BD");
    expect(posts.map((p) => p.path)).toEqual([
      "act_111/adimages",
      "act_111/adcreatives",
      "act_111/ads",
    ]);
    expect(posts[0]!.files).toEqual(["filename:photo.jpg"]);
    const story = JSON.parse(posts[1]!.body.object_story_spec!);
    expect(story).toMatchObject({
      page_id: "7777",
      link_data: {
        image_hash: "HASH123",
        link: "https://mybrand.com/serum",
        call_to_action: { type: "SHOP_NOW" },
      },
    });
    expect(posts[2]!.body).toMatchObject({
      adset_id: "501",
      status: "PAUSED",
      name: "Oct - Glow photo",
    });
    expect(JSON.parse(posts[2]!.body.creative!)).toEqual({ creative_id: "CR7" });

    const again = await call(ctx, "execute_ad_action", { action_id: proposal.data.action_id });
    expect(again.data.error).toContain("already executed");
    const files = await call(ctx, "list_creative_files");
    expect(
      files.data.files.find((f: { file: string }) => f.file === "october/photo.jpg").used_in_ads,
    ).toEqual(["AD8"]);
    const log = await call(ctx, "list_ad_actions");
    expect(log.data.actions[0]).toMatchObject({
      type: "new_ad",
      status: "executed",
      confirmed_via: "elicitation",
    });
  });

  it("does nothing when the user declines in the confirmation dialog", async () => {
    const { ctx, posts } = setup({ confirm: "declined" });
    const p = await call(ctx, "propose_status_change", {
      level: "ad",
      object_id: "601",
      new_status: "PAUSED",
    });
    const r = await call(ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(r.data.status).toBe("cancelled");
    expect(posts).toEqual([]);
  });

  it("falls back to the client's tool-permission prompt when dialogs aren't supported, and records it", async () => {
    const { ctx, posts, objects } = setup({ confirm: "unsupported" });
    const p = await call(ctx, "propose_status_change", {
      level: "ad",
      object_id: "601",
      new_status: "PAUSED",
      reason: "CPA 2x target",
    });
    expect(p.data.preview.status).toEqual({ from: "ACTIVE", to: "PAUSED" });
    const r = await call(ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(r.data.confirmed_via).toBe("tool_permission");
    expect(posts).toEqual([{ path: "601", body: { status: "PAUSED" }, files: [] }]);
    expect(objects["601"]!.status).toBe("PAUSED");
  });

  it("never touches objects of another client's ad account", async () => {
    const { ctx, posts } = setup();
    const r = await call(ctx, "propose_budget_change", {
      level: "adset",
      object_id: "999",
      new_daily_budget: 100,
    });
    expect(r.isError).toBe(true);
    expect(r.data.error).toContain("does not belong to this project's ad account (act_111)");
    expect(posts).toEqual([]);
  });

  it("changes budgets in minor units, enforces the cap, warns on big jumps and refuses stale proposals", async () => {
    const { ctx, posts, objects } = setup({ cap: 2000 });
    const tooHigh = await call(ctx, "propose_budget_change", {
      level: "adset",
      object_id: "501",
      new_daily_budget: 2500,
    });
    expect(tooHigh.data.error).toContain("safety cap of BDT 2,000");

    const p = await call(ctx, "propose_budget_change", {
      level: "adset",
      object_id: "501",
      new_daily_budget: 1500,
    });
    expect(p.data.preview.daily_budget).toEqual({
      from: "BDT 1,000",
      to: "BDT 1,500",
      change_pct: 50,
    });
    expect(p.data.preview.warnings[0]).toContain("learning phase");
    await call(ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(posts.at(-1)).toEqual({ path: "501", body: { daily_budget: "150000" }, files: [] });

    const stale = await call(ctx, "propose_budget_change", {
      level: "adset",
      object_id: "501",
      new_daily_budget: 1600,
    });
    objects["501"]!.daily_budget = "170000"; // someone changed it in Ads Manager meanwhile
    const r = await call(ctx, "execute_ad_action", { action_id: stale.data.action_id });
    expect(r.isError).toBe(true);
    expect(r.data.error).toContain("changed in Ads Manager");
    expect(r.data.hint).toContain("Nothing was changed");
  });

  it("expires unconfirmed proposals after 30 minutes", async () => {
    const t = setup();
    const p = await call(t.ctx, "propose_duplicate", {
      level: "ad",
      object_id: "601",
      status: "PAUSED",
    });
    t.setNow(new Date(TEST_NOW.getTime() + 31 * 60_000));
    const r = await call(t.ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(r.data.error).toContain("expired");
    expect(t.posts).toEqual([]);
  });

  it("duplicates and renames", async () => {
    const { ctx, posts } = setup();
    const p = await call(ctx, "propose_duplicate", {
      level: "adset",
      object_id: "501",
      status: "PAUSED",
      new_name: "Dhaka - scale test",
    });
    const r = await call(ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(r.data.error ?? "").toBe("");
    expect(r.data.result.new_id).toBe("AS-COPY");
    expect(posts).toEqual([
      { path: "501/copies", body: { status_option: "PAUSED", deep_copy: "true" }, files: [] },
      { path: "AS-COPY", body: { name: "Dhaka - scale test" }, files: [] },
    ]);
  });

  it("video ads resume after Meta finishes processing, without a second confirmation", async () => {
    const t = setup({ graph: { videoProcessingPolls: 30 } });
    const p = await call(t.ctx, "propose_new_ad", {
      ...NEW_AD,
      file: "reel.mp4",
      status: "ACTIVE",
    });
    expect(p.data.preview.warnings.join(" ")).toContain("start delivering");
    const first = await call(t.ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(first.data.status).toBe("processing");
    expect(t.posts.map((x) => x.path)).toEqual(["act_111/advideos"]);
    t.ctx.env.META_WRITE_ENABLED = false; // switched off after confirming: resume must refuse
    const blocked = await call(t.ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(blocked.data.error).toContain("turned off");
    t.ctx.env.META_WRITE_ENABLED = true;
    const second = await call(t.ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(second.data.status).toBe("executed");
    expect(t.decisions).toHaveLength(1);
    const story = JSON.parse(t.posts[1]!.body.object_story_spec!);
    expect(story.video_data).toMatchObject({
      video_id: "VID9",
      image_url: "https://thumb/2",
      title: "Vitamin C Serum",
    });
    expect(t.posts[2]!.body.status).toBe("ACTIVE");
  });

  it("reports partial results when a later step fails", async () => {
    const { ctx } = setup({ graph: { failCreative: true } });
    const p = await call(ctx, "propose_new_ad", NEW_AD);
    const r = await call(ctx, "execute_ad_action", { action_id: p.data.action_id });
    expect(r.isError).toBe(true);
    expect(r.data.hint).toContain("HASH123");
    expect((await call(ctx, "list_ad_actions", { status: "failed" })).data.actions).toHaveLength(1);
  });

  it("rejects files outside creatives/ and missing Page settings", async () => {
    const { ctx, ws } = setup();
    expect(
      (await call(ctx, "propose_new_ad", { ...NEW_AD, file: "../business.yaml" })).data.error,
    ).toContain("creatives/ folder");
    ws.configureMeta("glow-bd", { META_PAGE_ID: "" });
    const r = await call(ws.context("glow-bd"), "propose_new_ad", NEW_AD);
    expect(r.data.error).toContain("no Facebook Page");
  });
});

describe("confirmation dialog over MCP (elicitation)", () => {
  async function connect(answer: { action: "accept" | "decline"; approve?: boolean } | null) {
    const t = setup();
    // Use the real server-side confirmer instead of the test stub.
    const server = createServer(t.ws);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "desktop", version: "1" },
      { capabilities: answer ? { elicitation: {} } : {} },
    );
    const asked: string[] = [];
    if (answer) {
      client.setRequestHandler(ElicitRequestSchema, async (req) => {
        asked.push(String((req.params as { message: string }).message));
        return answer.action === "accept"
          ? { action: "accept", content: { approve: answer.approve ?? true } }
          : { action: "decline" };
      });
    }
    await Promise.all([server.connect(st), client.connect(ct)]);
    const run = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(
        (
          (await client.callTool({ name, arguments: { project: "glow-bd", ...args } })).content as {
            text: string;
          }[]
        )[0]!.text,
      );
    return { ...t, client, run, asked };
  }

  it("asks the user directly and executes only on approve", async () => {
    const t = await connect({ action: "accept", approve: true });
    const p = await t.run("propose_status_change", {
      level: "ad",
      object_id: "601",
      new_status: "PAUSED",
    });
    const r = await t.run("execute_ad_action", { action_id: p.action_id });
    expect(r.status).toBe("executed");
    expect(t.asked[0]).toContain('Pause ad "UGC Review"');
    expect(t.asked[0]).toContain("Glow BD");
  });

  it("treats an unticked box or a decline as no", async () => {
    for (const answer of [
      { action: "accept" as const, approve: false },
      { action: "decline" as const },
    ]) {
      const t = await connect(answer);
      const p = await t.run("propose_status_change", {
        level: "ad",
        object_id: "601",
        new_status: "PAUSED",
      });
      expect((await t.run("execute_ad_action", { action_id: p.action_id })).status).toBe(
        "cancelled",
      );
      expect(t.posts).toEqual([]);
    }
  });

  it("marks execute_ad_action as destructive so clients ask before running it", async () => {
    const t = await connect(null);
    const { tools } = await t.client.listTools();
    expect(tools.find((x) => x.name === "execute_ad_action")!.annotations?.destructiveHint).toBe(
      true,
    );
    expect(tools.find((x) => x.name === "propose_new_ad")!.annotations?.destructiveHint).toBe(
      false,
    );
  });
});
