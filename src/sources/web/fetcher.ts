import { FetchBlockedError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { isPathAllowed, parseRobots, type RobotsRules } from "./robots.js";

export interface FetcherOptions {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  userAgent: string;
  timeoutMs: number;
  maxBytes?: number;
  minIntervalMs?: number;
  /** Monotonic-ish clock in ms (injectable for tests). */
  clock?: () => number;
}

export interface FetchedPage {
  url: string;
  final_url: string;
  status: number;
  content_type: string;
  html: string;
  truncated: boolean;
}

export const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Polite fetcher for public pages: identifies itself, obeys robots.txt, waits ≥1s between requests to the
 * same host, times out, caps the body size, and never sends cookies or logs in. No JavaScript rendering.
 */
export class PoliteFetcher {
  private readonly robots = new Map<string, RobotsRules | "blocked">();
  private readonly lastRequest = new Map<string, number>();
  private readonly maxBytes: number;
  private readonly minIntervalMs: number;
  private readonly clock: () => number;

  constructor(private readonly opts: FetcherOptions) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.clock = opts.clock ?? (() => Date.now());
  }

  /** Product token used to match robots.txt groups, e.g. "AIMarketingManagerBot". */
  get agentToken(): string {
    return this.opts.userAgent.split(/[\s/]/)[0] ?? this.opts.userAgent;
  }

  async fetchPage(rawUrl: string): Promise<FetchedPage> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new FetchBlockedError(`Invalid URL: ${rawUrl}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new FetchBlockedError(`Only http(s) URLs are fetched: ${rawUrl}`);
    if (!(await this.isAllowed(url)))
      throw new FetchBlockedError(`robots.txt of ${url.host} disallows fetching ${url.pathname}.`);

    const res = await this.rawFetch(url);
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) throw new FetchBlockedError(`${url.href} returned HTTP ${res.status}.`);
    if (contentType && !/html|text\/plain|xml/i.test(contentType)) {
      throw new FetchBlockedError(`${url.href} is not an HTML page (${contentType}).`);
    }
    const { text, truncated } = await this.readCapped(res);
    if (truncated) logger.warn(`${url.href} exceeded ${this.maxBytes} bytes; truncated.`);
    return {
      url: rawUrl,
      final_url: res.url || url.href,
      status: res.status,
      content_type: contentType,
      html: text,
      truncated,
    };
  }

  async isAllowed(url: URL): Promise<boolean> {
    const origin = url.origin;
    let rules = this.robots.get(origin);
    if (!rules) {
      rules = await this.loadRobots(url);
      this.robots.set(origin, rules);
    }
    if (rules === "blocked") return false;
    return isPathAllowed(rules, url.pathname + url.search);
  }

  private async loadRobots(url: URL): Promise<RobotsRules | "blocked"> {
    try {
      const res = await this.rawFetch(new URL("/robots.txt", url.origin));
      if (res.status >= 500) return "blocked"; // server trouble: be conservative
      if (!res.ok) return { allow: [], disallow: [] }; // 4xx: no robots.txt → everything allowed
      const { text } = await this.readCapped(res, 512 * 1024);
      return parseRobots(text, this.agentToken);
    } catch (err) {
      logger.warn(`Could not read robots.txt for ${url.origin}: ${(err as Error).message}`);
      return "blocked";
    }
  }

  private async rawFetch(url: URL): Promise<Response> {
    const host = url.host;
    const last = this.lastRequest.get(host);
    if (last !== undefined) {
      const wait = last + this.minIntervalMs - this.clock();
      if (wait > 0) await this.opts.sleep(wait);
    }
    this.lastRequest.set(host, this.clock());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      return await this.opts.fetch(url.href, {
        signal: controller.signal,
        redirect: "follow",
        credentials: "omit",
        headers: {
          "User-Agent": this.opts.userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        },
      });
    } catch (err) {
      const msg =
        (err as Error).name === "AbortError"
          ? `timed out after ${this.opts.timeoutMs}ms`
          : (err as Error).message;
      throw new FetchBlockedError(`Could not fetch ${url.href}: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readCapped(
    res: Response,
    cap = this.maxBytes,
  ): Promise<{ text: string; truncated: boolean }> {
    if (!res.body) return { text: await res.text(), truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > cap) {
        chunks.push(value.subarray(0, cap - size));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
    return { text: Buffer.concat(chunks).toString("utf8"), truncated };
  }
}
