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
  EventDocument,
  EventEntity,
  EventRelation,
  Fallacy,
  Frame,
  MediaAnalysis,
  ScientificPlurality,
  StatisticalIssue,
  TimelineEvent,
  TimingAnalysis,
  UnsubstantiatedClaim,
} from "@/lib/types";
import type { SplitSummary } from "./summary";

/** The tabs under "Wie zegt wat?" (Epic 14): one per question you can ask the news. */
export type TabId = "invalshoeken" | "klopt" | "stemmen" | "ontbreekt" | "vragen" | "gebracht" | "tijdlijn";

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

/**
 * A voice that was missing and that an AI search found here (Story 14.10): approved by the admin,
 * the article was added to the event for this voice.
 */
export interface FoundVoice {
  /** The missing voice it was searched for ("Boeren op de polder") */
  perspective: string;
  /** Who speaks in the article ("LTO Noord") */
  who: string | null;
  /** What they say, in the words of the check (never the article text) */
  gist: string | null;
  /** The missing voice in the app it answers: `gap:<hash>` or `own:<id>` */
  gapKey: string | null;
}

export interface ExploreArticle {
  id: number;
  /** Article title — as link text to the article, and in the balloon when no summary sentence names its outlet */
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
  /** Added because a missing voice speaks here (AI search, approved), or null */
  foundVoice: FoundVoice | null;
  /** The same text as other articles of this news (Story 14.27), or null */
  copy: ArticleCopy | null;
  /** Pages of other sites the article text links to (source_metadata.links), in order; empty when none */
  links?: string[];
  /** Earlier headlines, oldest first (Story 14.32); empty when the headline never changed */
  titleHistory?: HeadlineChange[];
  /** Studies whose sponsor the article names (Story 14.36) */
  sponsored?: SponsoredStudy[];
  /** A source the reader added themselves: the id of that entry (own.ts) */
  ownId?: string;
}

/** An earlier headline of an article and when the next one was first seen (Story 14.32) */
export interface HeadlineChange {
  title: string;
  /** ISO time the poll first saw the headline that replaced it */
  until: string;
}

/** A study the article reports, with who ordered it, read from the article's own sentence (Story 14.36) */
export interface SponsoredStudy {
  sponsor: string;
  researcher: string | null;
  sentence: string;
  /** The sponsor is the outlet itself ("in opdracht van deze site") */
  self: boolean;
}

/**
 * The same text as other articles of the news (Story 14.27): agency copy, or one article of a
 * publisher in several of its titles. The backend job "Copy Detection" compares the texts (no AI).
 */
export interface ArticleCopy {
  /** The group: the id of its first article */
  group: number;
  /** Share of this article's text (outside quotes) that the others of the group have word for word, 0..1 */
  share: number;
  /** The article of the group it shares most with */
  match: number;
  /** Chance that this article and that one are copies of one text, 0..1 */
  probability: number;
  /** Where the one text comes from: an agency, the publisher's own article, or not known */
  source: "persbureau" | "uitgever" | null;
  /** The agency a text of the group names ("ANP") */
  agency: string | null;
  /** The agency it will be when none is named: Dutch agency copy is the ANP's */
  likelyAgency: string | null;
  /** The owner of every title in the group, when they have one */
  publisher: string | null;
}

export interface CopyGroupArticle {
  article: ExploreArticle;
  /** Share of its text (outside quotes) that the others of the group have word for word, 0..1 */
  share: number;
  /** Chance that it is a copy of the group's text, 0..1 */
  probability: number;
}

/** Articles of different outlets that are one text (Story 14.27) */
export interface CopyGroup {
  /** The id of the group's first article */
  key: number;
  source: ArticleCopy["source"];
  agency: string | null;
  likelyAgency: string | null;
  publisher: string | null;
  /** First published first */
  articles: CopyGroupArticle[];
  outletKeys: string[];
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
  /** One of its articles was added for a missing voice: in the picture by default, also from abroad */
  foundVoice?: boolean;
  /** Added by the reader (a source of their own, own.ts): not part of the analysis */
  own?: boolean;
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
  /** Government and party documents about this news (Bron, Story 14.29) */
  documents?: EventDocument[];
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

// --- Findings --------------------------------------------------------------------------------

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

export type FindingBody =
  | { type: "perspective"; cluster: Cluster; index: number; stances: StanceEntry[] }
  | { type: "voices"; outletKey: string; actors: { name: string; key: string; role: string | null }[]; sourcingPattern: string | null }
  | { type: "contradiction"; contradiction: Contradiction; outletsA: string[]; outletsB: string[] }
  | { type: "claim"; claim: UnsubstantiatedClaim; outletKey: string | null; actorKey: string }
  | { type: "statistic"; issue: StatisticalIssue; outletKey: string | null }
  | { type: "fallacy"; fallacy: Fallacy }
  | { type: "authority"; authority: AuthorityAnalysis; outletKey: string | null; actorKey: string }
  | { type: "timing"; timing: TimingAnalysis }
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
  /** A question the article of this outlet did not ask (one finding per question) */
  | { type: "question"; question: string; analysis: MediaAnalysis; outletKey: string | null }
  | { type: "science"; plurality: ScientificPlurality }
  | { type: "first"; order: OutletRef[] }
  | { type: "timeline"; item: TimelineEvent; timeLabel: string; historic: boolean }
  /** Articles of different outlets that are one text: one voice, not several (Story 14.27) */
  | { type: "copy"; group: CopyGroup }
  | { type: "own"; entry: OwnEntry };

export type FindingType = FindingBody["type"];
/** What the analysis found (everything but the reader's own entries) */
export type AnalysisBody = Exclude<FindingBody, { type: "own" }>;
export type AnalysisType = AnalysisBody["type"];

/** What a reader can add to the picture themselves: their own answer to the questions under it. */
export type OwnKind =
  | "claim"
  | "fallacy"
  | "contradiction"
  | "error"
  | "speaker"
  | "source"
  | "gap"
  | "question"
  | "note"
  | "moment";

export interface OwnEntry {
  /** `own:<random>`, also the id of its finding */
  id: string;
  kind: OwnKind;
  /** The claim, the reasoning, what they contradict each other on, what is wrong, the name, what a
   * source brings, the missing voice, the question, the remark or what happened */
  text: string;
  /** Why you doubt it, why the reasoning fails, what each side says, what is right, a role or
   * organisation, who speaks in a source, why it matters */
  detail?: string;
  /** Speaker: what they say */
  quote?: string;
  /** Who says it, who should answer, or with which outlet: `outlet:<key>` or `speaker:<id>` */
  anchor?: string;
  /** Contradiction: who says the opposite, like `anchor` */
  against?: string;
  /** Error: the finding of the analysis it corrects */
  about?: string;
  /** Fallacy: which reasoning error (a key of FALLACY_LABELS) */
  fallacy?: string;
  /** The reader's source; for a source: its link (required) */
  url?: string;
  /** Source: its headline, only as link text */
  title?: string;
  /** Moment: YYYY-MM-DD */
  date?: string;
  /** Shared with other readers ("Van anderen") since then */
  sharedAt?: string;
  /** Taken over from another reader: the id of what they shared */
  from?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Finding {
  /** `<type>:<hash>` (stable; the old clue id without its spoor prefix) */
  id: string;
  tab: TabId;
  type: FindingType;
  /** Outlets this finding is about */
  outletKeys: string[];
  /** Keys for links on the board ("outlet:nos", "actor:mark-rutte", ...) */
  links: NodeId[];
  order: number;
  body: FindingBody;
}
