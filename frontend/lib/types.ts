export type TimelineEvent = {
  time: string;
  event: string;
};

export type ClusterSource = {
  title: string;
  url: string;
};

export type Cluster = {
  angle: string;
  summary: string;
  sources: ClusterSource[];
};

export type Fallacy = {
  type: string;
  claim: string;
  explanation: string;
  sources: ClusterSource[];
};

export type Contradiction = {
  topic: string;
  claim_A: string;
  claim_B: string;
  status: string;
  source_A?: ClusterSource | null;
  source_B?: ClusterSource | null;
};

export type AggregationResponse = {
  query: string;
  generated_at: string;
  llm_provider?: string;
  timeline: TimelineEvent[];
  clusters: Cluster[];
  fallacies: Fallacy[];
  contradictions: Contradiction[];
};
