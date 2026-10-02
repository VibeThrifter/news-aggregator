/**
 * Core types of the exploration model (Epic 11 "Onderzoeksmodus").
 */

import type {
  AggregationResponse,
  ArticleBiasAnalysis,
  AuthorityAnalysis,
  Cluster,
  Contradiction,
  CoverageGap,
  EventEntity,
  EventRelation,
  Fallacy,
  Frame,
  InvolvedCountry,
  MediaAnalysis,
  ScientificPlurality,
  StatisticalIssue,
  TimelineEvent,
  TimingAnalysis,
  UnsubstantiatedClaim,
} from "@/lib/types";
import type { SplitSummary } from "./summary";

export type SpoorId =
  | "wie-zegt-wat"
  | "wat-klopt-niet"
  | "wie-heeft-belang"
  | "hoe-gebracht"
  | "wat-zie-je-niet"
  | "hoe-liep-het"
  | "buitenland";

export type OwnershipType = "public" | "corporate" | "independent" | "state" | "cooperative" | "trust" | "unknown";

/** Static identity of an outlet (see media-landscape.ts). */
export interface OutletProfile {
  key: string;
  name: string;
  aliases: string[];
  domains: string[];
  country: string;
  mediaType?: string;
  /** 0 (links) .. 10 (rechts) or "alternative" */
  spectrum?: number | "alternative" | null;
  /** Editorial left-right estimate 0..10 for outlets without a numeric feed spectrum (Epic 8 political_position) */
  politicalX?: number;
  /** Editorial estimate (Epic 8 establishment_score): -1 = alternatief .. +1 = gevestigd */
  establishment?: number;
  /** Editorial estimate of the ownership type (details come from the propaganda model) */
  ownershipType?: OwnershipType;
  /** Entity id in the propaganda-model project */
  pmEntityId?: number;
  wikipediaTitle?: string;
  /** Ingested by the aggregator (NL feeds) */
  monitored?: boolean;
  /** Outlets this source criticises (a "flak" signal, e.g. Een Blik op de NOS -> NOS) */
  watchdogOf?: string[];
}

/** What a foreign article reports, written by the LLM in Dutch (never the article text). */
export interface ArticleDigest {
  /** At most two sentences, in the words of the analysis */
  text: string;
  /** "title" when the article text could not be fetched: then it is the headline in Dutch */
  basis: "text" | "title";
}

export interface ExploreArticle {
  id: number;
  /** Article title — only as link text to the article itself */
  title: string;
  url: string;
  urlKey: string;
  fingerprint: string;
  outletKey: string;
  outletName: string;
  publishedAt: string | null;
  isInternational: boolean;
  sourceCountry: string | null;
  /** Dutch gist of a foreign article (backend job "Article Digest"), or null */
  digest: ArticleDigest | null;
}

export interface ExploreOutlet {
  key: string;
  name: string;
  domain: string | null;
  isInternational: boolean;
  country: string | null;
  /** 0..10, null when unknown or alternative */
  spectrum: number | null;
  isAlternative: boolean;
  /** Left-right position 0..10 for the 2D map (feed spectrum, or an editorial estimate for alternatives) */
  x: number | null;
  /** -1 alternatief .. +1 gevestigd (editorial estimate), null when unknown */
  establishment: number | null;
  articleIds: number[];
  firstPublishedAt: string | null;
  profile: OutletProfile | null;
}

export interface ExploreEventMeta {
  id: number;
  slug: string | null;
  /** LLM title (copyright rule) */
  title: string;
  eventType: string | null;
  articleCount: number;
  firstSeenAt: string | null;
  lastUpdatedAt: string | null;
  archived: boolean;
  /** Fictional demo data (negative ids): show a banner, never link to article URLs */
  isDemo: boolean;
}

export interface ExploreAvailability {
  entities: boolean;
  relations: boolean;
  bias: boolean;
}

export interface ExploreInput {
  event: ExploreEventMeta;
  summary: SplitSummary;
  articles: ExploreArticle[];
  outlets: ExploreOutlet[];
  insight: AggregationResponse | null;
  entities: EventEntity[];
  relations: EventRelation[];
  /** Latest bias analysis per article id */
  bias: Record<number, ArticleBiasAnalysis>;
  availability: ExploreAvailability;
}

// --- Knowledge graph -------------------------------------------------------------------------

export type NodeKind =
  | "event"
  | "outlet"
  | "perspective"
  | "actor"
  | "entity"
  | "frame"
  | "claim"
  | "contradiction"
  | "fallacy"
  | "statistic"
  | "gap"
  | "country"
  | "related";

export type NodeId = `${NodeKind}:${string}`;

export interface GraphNode {
  id: NodeId;
  kind: NodeKind;
  label: string;
  /** Shown instead of label while the node is not yet discovered */
  maskedLabel?: string;
  /** Clues that reveal this node */
  clueIds: string[];
  /** Always visible (event, outlets) */
  baseline: boolean;
  /** Relative importance, used for sizing */
  weight: number;
  outletKey?: string;
  iso?: string;
  entityKey?: string;
  relatedEventId?: number;
  relatedSlug?: string | null;
}

export type EdgeKind =
  | "perspective"
  | "quotes"
  | "mentions"
  | "frames"
  | "claims"
  | "publishes_claim"
  | "contradicts"
  | "fallacy"
  | "statistic"
  | "involves"
  | "related"
  | "reports";

export interface GraphEdge {
  id: string;
  source: NodeId;
  target: NodeId;
  kind: EdgeKind;
  label?: string;
  clueIds: string[];
  attribution?: "eigen_framing" | "geciteerd" | null;
}

export interface ExploreGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<NodeId, GraphNode>;
}

// --- Clues -----------------------------------------------------------------------------------

export interface StanceEntry {
  outletKey: string;
  stance: string | null;
  articleId: number | null;
}

export interface OutletRef {
  outletKey: string;
  publishedAt: string | null;
  lagMinutes: number;
}

export type ClueBody =
  | { type: "perspective"; cluster: Cluster; index: number; stances: StanceEntry[] }
  | { type: "voices"; outletKey: string; actors: { name: string; key: string; role: string | null }[]; sourcingPattern: string | null }
  | { type: "contradiction"; contradiction: Contradiction; outletsA: string[]; outletsB: string[] }
  | { type: "claim"; claim: UnsubstantiatedClaim; outletKey: string | null; actorKey: string }
  | { type: "statistic"; issue: StatisticalIssue; outletKey: string | null }
  | { type: "fallacy"; fallacy: Fallacy }
  | { type: "authority"; authority: AuthorityAnalysis; outletKey: string | null; actorKey: string }
  | { type: "timing"; timing: TimingAnalysis }
  | { type: "ownership"; outletKeys: string[] }
  | { type: "frame"; frame: Frame }
  | { type: "tone"; analysis: MediaAnalysis; outletKey: string | null }
  | {
      type: "bias";
      outletKey: string;
      articleIds: number[];
      averageRating: number;
      sentenceCount: number;
      topTypes: { type: string; count: number }[];
    }
  | { type: "gap"; gap: CoverageGap }
  | { type: "questions"; analysis: MediaAnalysis; outletKey: string | null }
  | { type: "science"; plurality: ScientificPlurality }
  | { type: "consensus"; clusterLabel: string }
  | { type: "first"; order: OutletRef[] }
  | { type: "timeline"; item: TimelineEvent; timeLabel: string; historic: boolean }
  | { type: "country"; country: InvolvedCountry };

export type ClueType = ClueBody["type"];

export interface Clue {
  id: string;
  spoor: SpoorId;
  type: ClueType;
  /** Shown while the card is face down */
  teaser: { title: string; hint?: string };
  /** Outlets shown as favicons on the card */
  outletKeys: string[];
  /** Graph nodes this clue reveals / links to */
  links: NodeId[];
  order: number;
  body: ClueBody;
}
