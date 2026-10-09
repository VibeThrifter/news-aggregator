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

export type FrameAttribution = "eigen_framing" | "geciteerd";

export type Frame = {
  frame_type: string;
  /** Specific technique (e.g. the exact metaphor or euphemism) */
  technique?: string | null;
  description: string;
  sources: string[];
  spectrum?: string | null;
  /** eigen_framing = the outlet frames it itself; geciteerd = it reports what others say */
  attribution?: FrameAttribution | null;
};

/** A country involved in the event, detected by the LLM (ISO 3166-1 alpha-2). */
export type InvolvedCountry = {
  iso_code: string;
  name: string;
  relevance: string;
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
  article_url?: string | null;
  evidence_provided: string;
  missing_context: string[];
  critical_questions: string[];
};

export type AuthorityAnalysis = {
  authority: string;
  authority_type: string;
  article_url?: string | null;
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
  article_url?: string | null;
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
  article_url?: string | null;
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
  model?: string | null;
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
  involved_countries?: InvolvedCountry[];
};

export type SpectrumDistribution =
  | Record<string, number | { count: number }>
  | Array<{ spectrum: string; count: number }>;

export interface EventSourceBreakdownEntry {
  source: string;
  article_count: number;
  spectrum?: string | number | null; // 0-10 scale or legacy string
  is_international?: boolean;
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
  event_type?: string | null;
  featured_image_url?: string | null;
  /** "Niet aan het woord": the first missing voices of the analysis */
  missing_voices?: string[] | null;
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
  spectrum?: string | number | null; // 0-10 scale or legacy string
  published_at?: string | null;
  summary?: string | null;
  image_url?: string | null;
  is_international?: boolean;
  source_country?: string | null; // ISO 3166-1 alpha-2 code
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

// Bias Analysis Types (Epic 10)
export type BiasSource = "journalist" | "framing" | "quote_selection" | "quote";

export interface SentenceBias {
  sentence_index: number;
  sentence_text: string;
  bias_type: string;
  bias_source: BiasSource;
  speaker?: string | null;
  score: number;
  explanation: string;
}

export interface BiasAnalysisSummary {
  total_sentences: number;
  journalist_bias_count: number;
  quote_bias_count: number;
  journalist_bias_percentage: number;
  most_frequent_journalist_bias?: string | null;
  most_frequent_count?: number | null;
  average_journalist_bias_strength?: number | null;
  overall_journalist_rating: number;
}

export interface ArticleBiasAnalysis {
  article_id: number;
  analyzed_at: string;
  provider: string;
  model: string;
  summary: BiasAnalysisSummary;
  journalist_biases: SentenceBias[];
  quote_biases: SentenceBias[];
}

export interface ArticleBiasResponse {
  data: ArticleBiasAnalysis;
  meta: {
    article_id: number;
    provider: string;
    model: string;
    analyzed_at: string;
  };
}

// Epic 11: derived exploration tables (database/migrations/004_explore_entities_relations.sql)

export type EntityKind = "person" | "org" | "place" | "country" | "group" | "event";

/** Canonical entity of an event, aggregated from article NER (table event_entities). */
export interface EventEntity {
  entity_key: string;
  name: string;
  kind: EntityKind;
  iso_code?: string | null;
  /** Slugs this entity matches on (full name, surname, acronym, ...) */
  aliases: string[];
  mention_count: number;
  article_count: number;
  /** Mentions per outlet (source_name -> count) */
  outlet_counts: Record<string, number>;
  salience: number;
  /** Articles of this event that mention the entity (added later to migration 004) */
  article_ids?: number[];
}

export type RelationReason =
  | { type: "entity"; key: string; name: string; kind: EntityKind }
  | { type: "country"; iso: string }
  | { type: "category"; value: string }
  | { type: "topic"; similarity: number };

/** A related event with denormalized display fields (table event_relations). */
export interface EventRelation {
  related_event_id: number;
  score: number;
  reasons: RelationReason[];
  related_slug?: string | null;
  /** LLM title of the related event (never an article title) */
  related_title: string;
  related_event_type?: string | null;
  related_article_count?: number | null;
  related_first_seen_at?: string | null;
  related_last_updated_at?: string | null;
}

/** Another event in which an entity appears (event_entities lookup by alias). */
export interface EntityAppearance {
  event_id: number;
  event_slug?: string | null;
  event_title: string;
  event_type?: string | null;
  event_last_updated_at?: string | null;
  mention_count: number;
}

/** An article as a reference (title as link text only, never its content) */
export interface ArticleRef {
  id: number;
  title: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
  is_international?: boolean | null;
  source_country?: string | null;
  event_id?: number | null;
  event_slug?: string | null;
  event_title?: string | null;
}

/** Another event in which an entity appears, with the articles that mention it */
export interface EntityArticleGroup {
  event_id: number;
  event_slug: string | null;
  event_title: string;
  event_last_updated_at: string | null;
  mention_count: number;
  articles: ArticleRef[];
}

export interface ArticleSearchResult {
  total: number;
  items: ArticleRef[];
}

// Epic 11 Story 11.17: propaganda-model graph (RPC functions from migration 005)

export type PmFilter =
  | "eigendom"
  | "advertentie"
  | "sourcing"
  | "flak"
  | "ideologie"
  | "tegenmacht"
  | "cross_filter"
  | "systeemactor"
  // Epic 15: the decision-making categories (same field, may overlap with the filters)
  | "formele_macht"
  | "belangen"
  | "kennis_advies"
  | "polder"
  | "werving";

export interface PmEntity {
  id: number;
  name: string;
  type: string;
  role?: string | null;
  primary_filter?: PmFilter | string | null;
  degree: number;
  active_from?: string | null;
  active_until?: string | null;
  /** Epic 12: approved by the news pipeline (machine account nieuws-autokeur), not by a person */
  auto_approved?: boolean;
  /** Epic 15 (migration 016): government layer of an organisation (eu, rijk, provincie, gemeente, waterschap, caribisch, regio) */
  bestuurslaag?: string | null;
  /** Epic 15: Wikidata id (Q…) */
  wikidata?: string | null;
}

export type PmCertainty = "onderbouwd" | "aannemelijk" | "onzeker";

export interface PmRelation {
  id: number;
  source_id: number;
  target_id: number;
  relation_type: string;
  mechanism?: string | null;
  /** Primary filter of the mechanism (edge colour); may be "cross_filter" */
  filter?: PmFilter | string | null;
  /** All filters of the mechanism (mechanism_filters); a relation can belong to several */
  filters?: string[] | null;
  aard?: string | null;
  certainty_label?: PmCertainty | string | null;
  active_from?: string | null;
  active_until?: string | null;
  source_count: number;
  bidirectional?: boolean;
  /** Epic 12: approved by the news pipeline (machine account nieuws-autokeur), not by a person */
  auto_approved?: boolean;
  /** Epic 15 (migration 016): the office or function as the register gives it ("Secretaris-generaal") */
  functie?: string | null;
}

export interface PmNeighborhood {
  center: PmEntity;
  entities: PmEntity[];
  relations: PmRelation[];
  /** Relations touching the center that match `filters` (all when null) */
  total: number;
  truncated: boolean;
  /** Relations touching the center per filter, regardless of `filters` ("overig" = no filter; missing = 0) */
  filter_counts?: Record<string, number>;
  /** Per filter: who the relations touching the center are with (entity type) and how (mechanism), over all of them (only `direction` when given) */
  breakdown?: Record<string, PmBreakdown>;
  /** The filters these relations were restricted to (null = all) */
  filters?: string[] | null;
  /** Per filter how many relations touching the center go each way of influence (migration 008; missing on older databases) */
  direction_counts?: Record<string, { in: number; out: number }>;
  /** The direction these relations were restricted to: "in" = influence on the center, "out" = the center's influence (null = both) */
  direction?: "in" | "out" | null;
}

/** Relations of one entity via one filter, counted per type of the other party and per mechanism. */
export interface PmBreakdown {
  types: Record<string, number>;
  mechanisms: Record<string, number>;
}

export interface PmSource {
  title?: string | null;
  url?: string | null;
  publisher?: string | null;
  published_at?: string | null;
  quote?: string | null;
  /** Epic 12: evidence of an argument that no person has merged yet ("nog niet gecontroleerd") */
  unreviewed?: boolean;
}

export interface PmDetails {
  kind: "entity" | "relation";
  id: number;
  title: string;
  type?: string | null;
  mechanism?: string | null;
  filter?: string | null;
  filters?: string[] | null;
  description?: string | null;
  active_from?: string | null;
  active_until?: string | null;
  certainty_label?: string | null;
  sources: PmSource[];
  /** Epic 12: approved by the news pipeline, not by a person */
  auto_approved?: boolean;
  /** Story 14.12 (migration 010), relations: the discussion behind it */
  arguments?: PmArgument[];
  /** Story 14.12, relations: its two ends (to read it as a sentence) */
  source?: Pick<PmEntity, "id" | "name" | "type"> | null;
  target?: Pick<PmEntity, "id" | "name" | "type"> | null;
  /** Story 14.12, relations: what its mechanism means in the model */
  mechanism_description?: string | null;
  mechanism_effect?: string | null;
  /** Epic 15 (migration 016): entities: government layer and Wikidata id; relations: the office */
  bestuurslaag?: string | null;
  wikidata?: string | null;
  functie?: string | null;
  /** Story 14.23 (migration 017), relations: where it comes from (opzet, register, eigenaar, assistent, agent) and when it was added */
  origin?: string | null;
  added_at?: string | null;
}

/** A source an argument cites (Story 14.12) */
export interface PmArgumentSource {
  title?: string | null;
  url?: string | null;
  publisher?: string | null;
  published_at?: string | null;
  /** nieuwsartikel, persbericht, rapport, academisch_artikel, … */
  kind?: string | null;
  quote?: string | null;
  /** An independent re-read found the quote and that the source carries the claim (automatic review) */
  checked?: boolean;
  /** What that re-read found when it did not hold (sync format 7) */
  check?: PmSourceCheck;
}

/** The source carries the claim only in part, does not carry it, or the quote is not in it */
export type PmSourceCheck = "deels" | "draagt_niet" | "citaat_weg";

/** Review status of an argument in the propaganda model */
export type PmArgumentStatus = "geverifieerd" | "ongecontroleerd" | "bronvermelding_nodig" | "betwist" | "verouderd" | "voorgesteld";

/**
 * Story 14.12 (migration 010): an argument for, against or nuancing a relation, as the propaganda
 * model keeps it: claim, review status and the sources it cites. Replies point at their parent.
 */
export interface PmArgument {
  id: number;
  parent_id?: number | null;
  /** What it is about: null = whether the relation exists; certainty, influence, active_from, … */
  aspect?: string | null;
  stance: "supporting" | "contradicting" | "contextual";
  status: PmArgumentStatus | string;
  claim: string;
  sources: PmArgumentSource[];
}

export interface PmMatch {
  alias: string;
  entity_id: number;
  name: string;
  type: string;
  /** Number of relations in the model (pm_match after migration 006; missing before) */
  degree?: number | null;
}

export interface PmMeta {
  version: string | null;
  synced_at: string | null;
  entity_count: number;
  relation_count: number;
}

/** Epic 13: one route between two entities (pm_paths, migration 007). */
export interface PmPathRoute {
  from: number;
  to: number;
  /** 1 = best route of this (from, to) pair */
  rank: number;
  hops: number;
  /** Entity ids from `from` to `to` */
  nodes: number[];
  /** Relation ids, one per hop, in path order */
  relations: number[];
  /** At least one relation had ended before the reference date */
  historic: boolean;
  /** Other `from` ids with the same explanation (same intermediates and kinds of relation) to `to` */
  shared_with: number[];
}

/** Epic 13: routes between two sets of entities, with everything on them (pm_paths, migration 007). */
export interface PmPaths {
  routes: PmPathRoute[];
  entities: PmEntity[];
  relations: PmRelation[];
  /** More routes existed than were returned (cap of 60) */
  truncated: boolean;
  max_hops: number;
  /** Reference date (YYYY-MM-DD) */
  at: string;
}

// Epic 12 "Wie is dit?": automatic research of names in the news (RPC functions, migration 006)

export type EntityResearchStatus =
  | "nieuw"
  | "niet_nodig"
  | "overgeslagen"
  | "wachtrij"
  | "bezig"
  | "klaar"
  | "niets_gevonden"
  | "twijfel"
  | "fout";

export type EntityResearchKind = "person" | "org" | "unknown";

export type EntityRoleCategory =
  | "politicus"
  | "journalist"
  | "woordvoerder"
  | "bestuurder"
  | "organisatie"
  | "expert"
  | "overig"
  | "prive"
  | "onbekend";

/** What the research added to the propaganda model */
export interface EntityResearchFound {
  entities?: number;
  relations?: number;
  /** Approved automatically (neutral structural facts with a source) */
  auto_approved?: number;
  /** Waiting for a person to review */
  pending?: number;
}

/** One row of entity_research_status(p_keys) */
export interface EntityResearch {
  /** "person:slug" | "org:slug" | "actor:slug" */
  entity_key: string;
  name: string;
  kind: EntityResearchKind | string;
  status: EntityResearchStatus | string;
  status_reason?: string | null;
  role_category?: EntityRoleCategory | string | null;
  role_label?: string | null;
  pm_entity_id?: number | null;
  pm_degree?: number | null;
  found?: EntityResearchFound | null;
  queued_at?: string | null;
  researched_at?: string | null;
  updated_at?: string | null;
}

/** Story 14.13: research of a thin propaganda-model link (relation_research, migration 011) */
export type RelationResearchStatus =
  | "nieuw"
  | "niet_nodig"
  | "wachtrij"
  | "bezig"
  | "klaar"
  | "niets_gevonden"
  | "overgeslagen"
  | "twijfel"
  | "fout";

/** What the research produced and how far its review is (counts only) */
export interface RelationResearchFound {
  arguments?: number;
  sources?: number;
  /** Still waiting for a human in the propaganda model */
  pending?: number;
  merged?: number;
  rejected?: number;
}

/** One row of relation_research_status / request_relation_research */
export interface RelationResearch {
  relation_id: number;
  status: RelationResearchStatus | string;
  status_reason?: string | null;
  found?: RelationResearchFound | null;
  queued_at?: string | null;
  researched_at?: string | null;
  updated_at?: string | null;
}

/** Result of request_entity_research(...) */
export interface EntityResearchRequest {
  ok: boolean;
  status?: EntityResearchStatus | string | null;
  reason?: string | null;
}

/** One row of entity_cooccurrence(p_aliases): who appears in the same news */
export interface EntityCooccurrence {
  entity_key: string;
  name: string;
  kind: "person" | "org" | string;
  shared_events: number;
  last_event_slug?: string | null;
  last_event_title?: string | null;
  last_seen?: string | null;
}
