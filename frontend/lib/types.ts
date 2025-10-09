export type TimelineEvent = {
  time: string;
  headline: string;
  sources: string[];
  spectrum?: string | null;
};

export type ClusterSource = {
  title: string;
  url: string;
  spectrum?: string | null;
  stance?: string | null;
};

export type Cluster = {
  label: string;
  spectrum?: string | null;
  source_types?: string[] | null;
  summary: string;
  characteristics?: string[] | null;
  sources: ClusterSource[];
};

export type Fallacy = {
  type: string;
  description: string;
  sources: string[];
  spectrum?: string | null;
};

export type Frame = {
  frame_type: string;
  description: string;
  sources: string[];
  spectrum?: string | null;
};

export type ContradictionClaim = {
  summary: string;
  sources: string[];
  spectrum?: string | null;
};

export type Contradiction = {
  topic: string;
  claim_a: ContradictionClaim;
  claim_b: ContradictionClaim;
  verification: string;
};

export type CoverageGap = {
  perspective: string;
  description: string;
  relevance: string;
  potential_sources: string[];
};

export type AggregationResponse = {
  query: string;
  generated_at: string;
  llm_provider?: string;
  summary?: string | null;
  timeline: TimelineEvent[];
  clusters: Cluster[];
  fallacies: Fallacy[];
  frames: Frame[];
  contradictions: Contradiction[];
  coverage_gaps?: CoverageGap[];
};

export type SpectrumDistribution =
  | Record<string, number | { count: number }>
  | Array<{ spectrum: string; count: number }>;

export interface EventSourceBreakdownEntry {
  source: string;
  article_count: number;
  spectrum?: string | null;
}

export interface EventListItem {
  id: number;
  slug?: string | null;
  title: string;
  description?: string | null;
  summary?: string | null;
  first_seen_at?: string | null;
  last_updated_at?: string | null;
  article_count: number;
  spectrum_distribution?: SpectrumDistribution | null;
  source_breakdown?: EventSourceBreakdownEntry[] | null;
  llm_provider?: string | null;
}

export interface EventFeedMeta extends Record<string, unknown> {
  last_updated_at?: string | null;
  last_updated?: string | null;
  last_refresh_at?: string | null;
  generated_at?: string | null;
  llm_provider?: string | null;
  active_provider?: string | null;
  total_events?: number | null;
  event_count?: number | null;
}

export interface EventArticle {
  id: number;
  title: string;
  url: string;
  source: string;
  spectrum?: string | null;
  published_at?: string | null;
  summary?: string | null;
}

export interface EventDetail extends EventListItem {
  articles?: EventArticle[] | null;
  insights_status?: string | null;
  insights_generated_at?: string | null;
  insights_requested_at?: string | null;
  keywords?: string[] | null;
}

export interface EventDetailMeta extends Record<string, unknown> {
  last_updated_at?: string | null;
  generated_at?: string | null;
  llm_provider?: string | null;
  insights_status?: string | null;
  insights_generated_at?: string | null;
  insights_requested_at?: string | null;
  first_seen_at?: string | null;
}
