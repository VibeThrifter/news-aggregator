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

// Nieuwe kritische analyse types
export type UnsubstantiatedClaim = {
  claim: string;
  presented_as: string;
  source_in_article: string;
  evidence_provided: string;
  missing_context: string[];
  critical_questions: string[];
};

export type AuthorityAnalysis = {
  authority: string;
  authority_type: string;
  claimed_expertise: string;
  actual_role?: string | null;
  scope_creep?: string | null;
  composition_question?: string | null;
  funding_sources?: string | null;
  track_record?: string | null;
  potential_interests: string[];
  independence_check?: string | null;
  critical_questions: string[];
};

export type MediaAnalysis = {
  source: string;
  tone: string;
  sourcing_pattern?: string | null;
  questions_not_asked: string[];
  perspectives_omitted?: string[];
  framing_by_omission?: string | null;
  copy_paste_score?: string | null;
  anonymous_source_count?: number;
  narrative_alignment?: string | null;
  what_if_wrong?: string | null;
};

export type StatisticalIssue = {
  claim: string;
  issue: string;
  better_framing?: string | null;
};

export type TimingAnalysis = {
  why_now: string;
  cui_bono?: string | null;
  upcoming_events?: string | null;
};

export type ScientificPlurality = {
  topic: string;
  presented_view: string;
  alternative_views_mentioned: boolean;
  known_debates: string[];
  notable_dissenters: string;
  assessment: string;
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
  // Kritische analyse velden
  unsubstantiated_claims?: UnsubstantiatedClaim[];
  authority_analysis?: AuthorityAnalysis[];
  media_analysis?: MediaAnalysis[];
  statistical_issues?: StatisticalIssue[];
  timing_analysis?: TimingAnalysis | null;
  scientific_plurality?: ScientificPlurality | null;
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
  has_llm_insights?: boolean;
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
  image_url?: string | null;
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
