/**
 * One call that turns raw API data into everything the event page renders.
 */

import { deriveFindings, findingsByTab } from "./findings";
import { ArticleIndex, buildExploreInput, type RawExploration } from "./input";
import { buildSpeakers, type SpeakerModel } from "./speakers";
import type { ExploreInput, ExploreOutlet, Finding, TabId } from "./types";

export interface Exploration {
  input: ExploreInput;
  index: ArticleIndex;
  findings: Finding[];
  findingById: Map<string, Finding>;
  byTab: Map<TabId, Finding[]>;
  /** Who speaks in this news, per outlet (Epic 14) */
  speakers: SpeakerModel;
  /** Outlets of sources the reader added that the news does not have (own.ts; not in `input`) */
  ownOutlets?: ExploreOutlet[];
}

export function buildExploration(raw: RawExploration): Exploration {
  const input = buildExploreInput(raw);
  const index = new ArticleIndex(input);
  const findings = deriveFindings(input, index);
  return {
    input,
    index,
    findings,
    findingById: new Map(findings.map((finding) => [finding.id, finding])),
    byTab: findingsByTab(findings),
    speakers: buildSpeakers(input, findings, index),
  };
}
