export interface MarketTrend {
  trend: string;
  evidence?: string;
  source_url?: string;
}

export interface MarketSnapshot {
  id: number;
  date: string;
  sector: string | null;
  summary: string;
  trends: MarketTrend[];
  sources: string[];
  created_at: string;
}
