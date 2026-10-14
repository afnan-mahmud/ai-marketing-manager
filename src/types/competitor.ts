export interface Competitor {
  id: number;
  name: string;
  website: string | null;
  facebook_page_id: string | null;
  notes: string | null;
  active: boolean;
  is_self: boolean;
}

export interface DetectedPrice {
  value: number;
  currency: string | null;
  text: string;
  context: string;
}

export interface SocialProof {
  text: string;
  kind: "rating" | "reviews" | "customers" | "testimonial";
  value: number | null;
}

export interface ExtractedPage {
  title: string | null;
  meta_description: string | null;
  headings: { level: 1 | 2 | 3; text: string }[];
  prices: DetectedPrice[];
  offers: string[];
  ctas: string[];
  social_proof: SocialProof[];
  text: string;
}

export interface WebsiteSnapshot {
  id: number;
  competitor_id: number;
  url: string;
  fetched_at: string;
  content_hash: string;
  title: string | null;
  meta_description: string | null;
  headings: ExtractedPage["headings"];
  prices: DetectedPrice[];
  offers: string[];
  ctas: string[];
  social_proof: SocialProof[];
  raw_text_path: string | null;
}

export interface CompetitorAd {
  id?: number;
  competitor_id: number;
  external_id: string;
  first_seen: string | null;
  last_seen: string | null;
  start_date: string | null;
  is_active: boolean;
  body: string | null;
  headline: string | null;
  cta: string | null;
  format: string | null;
  landing_url: string | null;
  platforms: string | null;
  source: "ad_library" | "manual";
}

export interface CompetitorSignal {
  competitor_id: number;
  date: string;
  signal: string;
  value: number;
  note: string | null;
}
