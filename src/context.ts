import { BusinessStore } from "./config/business.js";
import type { Env } from "./config/env.js";
import { buildPaths, resolveFromRoot, type Paths } from "./config/paths.js";
import { openDb, type DB } from "./db/client.js";
import { AdsRepo } from "./db/repositories/adsRepo.js";
import { CompetitorRepo } from "./db/repositories/competitorRepo.js";
import { MarketRepo } from "./db/repositories/marketRepo.js";
import { ReportRepo } from "./db/repositories/reportRepo.js";
import { createServices, type Services } from "./services/index.js";
import { toIsoDate } from "./utils/dates.js";

export interface AppContext {
  env: Env;
  paths: Paths;
  db: DB;
  business: BusinessStore;
  repos: { ads: AdsRepo; competitors: CompetitorRepo; market: MarketRepo; reports: ReportRepo };
  services: Services;
  /** Current time (injectable for tests). */
  now: () => Date;
  /** Today's local date, YYYY-MM-DD. */
  today: () => string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export interface ContextOptions {
  env: Env;
  /** Pass ":memory:" in tests. Defaults to <DATA_DIR>/app.db. */
  dbFile?: string;
  now?: () => Date;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createContext(opts: ContextOptions): AppContext {
  const paths = buildPaths(
    resolveFromRoot(opts.env.DATA_DIR),
    resolveFromRoot(opts.env.BUSINESS_CONFIG),
  );
  const db = openDb(opts.dbFile ?? paths.dbFile);
  const now = opts.now ?? (() => new Date());
  const ctx = {
    env: opts.env,
    paths,
    db,
    business: new BusinessStore(paths.businessConfig),
    repos: {
      ads: new AdsRepo(db),
      competitors: new CompetitorRepo(db),
      market: new MarketRepo(db),
      reports: new ReportRepo(db),
    },
    now,
    today: () => toIsoDate(now()),
    fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
    sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  } as Omit<AppContext, "services"> as AppContext;
  ctx.services = createServices(ctx);
  return ctx;
}
