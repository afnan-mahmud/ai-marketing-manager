import type { DB } from "../client.js";
import type { MarketSnapshot, MarketTrend } from "../../types/market.js";

interface Row {
  id: number;
  date: string;
  sector: string | null;
  summary: string;
  trends_json: string;
  sources_json: string;
  created_at: string;
}

const toSnapshot = (r: Row): MarketSnapshot => ({
  id: r.id,
  date: r.date,
  sector: r.sector,
  summary: r.summary,
  trends: JSON.parse(r.trends_json || "[]") as MarketTrend[],
  sources: JSON.parse(r.sources_json || "[]") as string[],
  created_at: r.created_at,
});

export class MarketRepo {
  constructor(private readonly db: DB) {}

  insert(s: Omit<MarketSnapshot, "id" | "created_at">): MarketSnapshot {
    const info = this.db
      .prepare(
        "INSERT INTO market_snapshots (date, sector, summary, trends_json, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        s.date,
        s.sector,
        s.summary,
        JSON.stringify(s.trends),
        JSON.stringify(s.sources),
        new Date().toISOString(),
      );
    return toSnapshot(
      this.db
        .prepare("SELECT * FROM market_snapshots WHERE id = ?")
        .get(Number(info.lastInsertRowid)) as Row,
    );
  }

  latest(limit: number): MarketSnapshot[] {
    return (
      this.db
        .prepare("SELECT * FROM market_snapshots ORDER BY date DESC, id DESC LIMIT ?")
        .all(limit) as Row[]
    ).map(toSnapshot);
  }

  since(date: string): MarketSnapshot[] {
    return (
      this.db
        .prepare("SELECT * FROM market_snapshots WHERE date >= ? ORDER BY date DESC, id DESC")
        .all(date) as Row[]
    ).map(toSnapshot);
  }
}
