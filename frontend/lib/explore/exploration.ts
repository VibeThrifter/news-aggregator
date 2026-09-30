/**
 * One call that turns raw API data into everything the Onderzoeksmodus renders.
 */

import { cluesBySpoor, deriveClues } from "./clues";
import { buildGraph } from "./graph";
import { ArticleIndex, buildExploreInput, type RawExploration } from "./input";
import type { Clue, ExploreGraph, ExploreInput, SpoorId } from "./types";

export interface Exploration {
  input: ExploreInput;
  index: ArticleIndex;
  clues: Clue[];
  clueById: Map<string, Clue>;
  bySpoor: Map<SpoorId, Clue[]>;
  graph: ExploreGraph;
}

export function buildExploration(raw: RawExploration): Exploration {
  const input = buildExploreInput(raw);
  const index = new ArticleIndex(input);
  const clues = deriveClues(input, index);
  return {
    input,
    index,
    clues,
    clueById: new Map(clues.map((clue) => [clue.id, clue])),
    bySpoor: cluesBySpoor(clues),
    graph: buildGraph(input, clues),
  };
}
