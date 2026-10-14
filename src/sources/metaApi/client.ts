import { MetaApiError } from "../../utils/errors.js";
import { logger, redact } from "../../utils/logger.js";

export interface MetaClientOptions {
  token: string;
  version: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseUrl?: string;
}

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  fbtrace_id?: string;
}

export interface Page<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Graph API error codes that mean "slow down" (app/account/user rate limits). */
const RATE_LIMIT_CODES = new Set([
  4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014,
]);
const MAX_BACKOFF_MS = 16_000;
/** Above this usage % we log a warning (Meta throttles at 100%). */
const USAGE_WARN_PCT = 80;

/** Minimal, read-only Graph API wrapper: auth, paging, retries with exponential backoff, rate-limit awareness. */
export class MetaApiClient {
  private readonly maxRetries: number;
  private readonly baseUrl: string;

  constructor(private readonly opts: MetaClientOptions) {
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseUrl = opts.baseUrl ?? "https://graph.facebook.com";
  }

  buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
    const url = new URL(`${this.baseUrl}/${this.opts.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.set("access_token", this.opts.token);
    return url.toString();
  }

  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    return this.request<T>(this.buildUrl(path, params));
  }

  /** Follows paging.next until exhausted (or maxPages). */
  async getAll<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    maxPages = 100,
  ): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = this.buildUrl(path, params);
    let pages = 0;
    while (url) {
      if (++pages > maxPages) {
        logger.warn(`Stopped paging ${path} after ${maxPages} pages`);
        break;
      }
      const page: Page<T> = await this.request<Page<T>>(url);
      out.push(...(page.data ?? []));
      url = page.paging?.next;
    }
    return out;
  }

  private async request<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.opts.fetch(url, { headers: { Accept: "application/json" } });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.backoff(attempt, `network error: ${(err as Error).message}`);
          continue;
        }
        throw new MetaApiError(
          `Could not reach the Meta Graph API: ${redact((err as Error).message)}`,
        );
      }
      this.checkUsageHeaders(res.headers);
      const body = (await res.json().catch(() => ({}))) as { error?: GraphError } & T;
      if (res.ok && !body.error) return body;

      const e = body.error ?? {};
      const retryable =
        res.status === 429 ||
        res.status >= 500 ||
        e.is_transient === true ||
        (e.code !== undefined && RATE_LIMIT_CODES.has(e.code));
      if (retryable && attempt < this.maxRetries) {
        await this.backoff(attempt, `HTTP ${res.status} code ${e.code ?? "-"}`);
        continue;
      }
      throw this.toError(res.status, e);
    }
  }

  private async backoff(attempt: number, why: string): Promise<void> {
    const ms = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    logger.warn(`Meta API retry ${attempt + 1}/${this.maxRetries} in ${ms}ms (${why})`);
    await this.opts.sleep(ms);
  }

  private checkUsageHeaders(headers: Headers): void {
    for (const name of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
      const raw = headers.get(name);
      if (!raw) continue;
      try {
        const values =
          JSON.stringify(JSON.parse(raw)).match(
            /"(call_count|total_cputime|total_time|acc_id_util_pct)":(\d+(\.\d+)?)/g,
          ) ?? [];
        const max = Math.max(0, ...values.map((v) => Number(v.split(":")[1])));
        if (max >= USAGE_WARN_PCT)
          logger.warn(`Meta API usage high (${name}: ${max}%) — requests may be throttled.`);
      } catch {
        /* ignore malformed usage headers */
      }
    }
  }

  private toError(status: number, e: GraphError): MetaApiError {
    const msg = redact(e.message ?? `HTTP ${status}`);
    let friendly: string;
    if (e.code === 190)
      friendly = `Meta access token is invalid or expired (${msg}). Generate a new token with ads_read.`;
    else if (
      e.code === 10 ||
      e.code === 200 ||
      (e.code !== undefined && e.code >= 200 && e.code < 300)
    ) {
      friendly = `Permission denied by Meta (${msg}). The token needs ads_read and access to this ad account.`;
    } else if (e.code !== undefined && RATE_LIMIT_CODES.has(e.code)) {
      friendly = `Meta rate limit reached (${msg}). Wait a while (often 5–60 minutes) and try again.`;
    } else if (e.code === 100)
      friendly = `Meta rejected the request parameters (${msg}). Check META_AD_ACCOUNT_ID and META_API_VERSION.`;
    else friendly = `Meta API error ${e.code ?? status}: ${msg}`;
    return new MetaApiError(
      friendly + (e.fbtrace_id ? ` [fbtrace_id ${e.fbtrace_id}]` : ""),
      status,
      e.code,
    );
  }
}
