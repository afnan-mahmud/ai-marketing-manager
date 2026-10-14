import { BusinessStore } from "./config/business.js";
import type { Env } from "./config/env.js";
import { buildPaths, type Paths } from "./config/paths.js";
import { openDb, type DB } from "./db/client.js";
import { ActionsRepo } from "./db/repositories/actionsRepo.js";
import { AdsRepo } from "./db/repositories/adsRepo.js";
import { CompetitorRepo } from "./db/repositories/competitorRepo.js";
import { MarketRepo } from "./db/repositories/marketRepo.js";
import { ReportRepo } from "./db/repositories/reportRepo.js";
import { createServices, type Services } from "./services/index.js";
import { toIsoDate } from "./utils/dates.js";

export interface ProjectInfo {
  name: string;
  slug: string;
  dir: string;
  created_at: string;
}

/** Everything one client project needs: its own env (Meta keys), files, database, profile and services. */
export interface AppContext {
  project: ProjectInfo;
  env: Env;
  paths: Paths;
  db: DB;
  business: BusinessStore;
  repos: {
    ads: AdsRepo;
    competitors: CompetitorRepo;
    market: MarketRepo;
    reports: ReportRepo;
    actions: ActionsRepo;
  };
  services: Services;
  /** Current time (injectable for tests). */
  now: () => Date;
  /** Today's local date, YYYY-MM-DD. */
  today: () => string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Asks the human (not Claude) to approve a change in Ads Manager, e.g. via MCP elicitation. */
  confirm: Confirmer;
}

export interface ConfirmRequest {
  title: string;
  message: string;
}

/**
 * "accepted"/"declined": the user answered in the MCP client's own dialog.
 * "unsupported": the client can't show such a dialog; the client's tool-permission prompt is the remaining gate.
 */
export type ConfirmDecision = "accepted" | "declined" | "unsupported";
export type Confirmer = (req: ConfirmRequest) => Promise<ConfirmDecision>;

export interface ContextOptions {
  project: ProjectInfo;
  env: Env;
  /** Pass ":memory:" in tests. Defaults to <project dir>/app.db. */
  dbFile?: string;
  now?: () => Date;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  confirm?: Confirmer;
}

export function createContext(opts: ContextOptions): AppContext {
  const paths = buildPaths(opts.project.dir);
  const db = openDb(opts.dbFile ?? paths.dbFile);
  const now = opts.now ?? (() => new Date());
  const ctx = {
    project: opts.project,
    env: opts.env,
    paths,
    db,
    business: new BusinessStore(paths.businessConfig),
    repos: {
      ads: new AdsRepo(db),
      competitors: new CompetitorRepo(db),
      market: new MarketRepo(db),
      reports: new ReportRepo(db),
      actions: new ActionsRepo(db),
    },
    now,
    today: () => toIsoDate(now()),
    fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
    sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    confirm: opts.confirm ?? (async () => "unsupported" as const),
  } as Omit<AppContext, "services"> as AppContext;
  ctx.services = createServices(ctx);
  return ctx;
}
