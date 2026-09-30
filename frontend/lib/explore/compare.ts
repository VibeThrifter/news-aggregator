/**
 * Bronvergelijker: everything the analysis says about one outlet in this event, and how two
 * outlets relate (contradictions between them).
 */

import { biasByOutlet, type OutletBias } from "./bias";
import { ArticleIndex } from "./input";
import { frameLabel, toneLabel } from "./labels";
import type { Clue, ExploreInput, ExploreOutlet } from "./types";

export interface OutletProfileView {
  outlet: ExploreOutlet;
  perspectives: { label: string; stance: string | null; clueId: string }[];
  tone: string | null;
  toneClueId: string | null;
  copyPaste: string | null;
  anonymousSources: number | null;
  ownFrames: string[];
  quotedFrames: string[];
  voices: { name: string; role: string | null }[];
  sourcingPattern: string | null;
  bias: OutletBias | null;
  questionsNotAsked: string[];
  claimCount: number;
  /** Clue ids the comparison touches (revealed when comparing) */
  clueIds: string[];
}

export function outletProfileView(
  outletKey: string,
  input: ExploreInput,
  clues: Clue[],
  index: ArticleIndex = new ArticleIndex(input),
): OutletProfileView | null {
  const outlet = index.outlet(outletKey);
  if (!outlet) return null;

  const view: OutletProfileView = {
    outlet,
    perspectives: [],
    tone: null,
    toneClueId: null,
    copyPaste: null,
    anonymousSources: null,
    ownFrames: [],
    quotedFrames: [],
    voices: [],
    sourcingPattern: null,
    bias: biasByOutlet(input).get(outletKey) ?? null,
    questionsNotAsked: [],
    claimCount: 0,
    clueIds: [],
  };

  for (const clue of clues) {
    const body = clue.body;
    switch (body.type) {
      case "perspective": {
        const stance = body.stances.find((entry) => entry.outletKey === outletKey);
        if (stance) {
          view.perspectives.push({ label: body.cluster.label, stance: stance.stance, clueId: clue.id });
          view.clueIds.push(clue.id);
        }
        break;
      }
      case "tone":
        if (body.outletKey === outletKey) {
          view.tone = toneLabel(body.analysis.tone);
          view.toneClueId = clue.id;
          view.copyPaste = body.analysis.copy_paste_score ?? null;
          view.anonymousSources = body.analysis.anonymous_source_count ?? null;
          view.clueIds.push(clue.id);
        }
        break;
      case "frame":
        if (clue.outletKeys.includes(outletKey)) {
          const label = frameLabel(body.frame.frame_type);
          if (body.frame.attribution === "geciteerd") {
            if (!view.quotedFrames.includes(label)) view.quotedFrames.push(label);
          } else if (!view.ownFrames.includes(label)) {
            view.ownFrames.push(label);
          }
          view.clueIds.push(clue.id);
        }
        break;
      case "voices":
        if (body.outletKey === outletKey) {
          view.voices = body.actors.map((actor) => ({ name: actor.name, role: actor.role }));
          view.sourcingPattern = body.sourcingPattern;
          view.clueIds.push(clue.id);
        }
        break;
      case "questions":
        if (body.outletKey === outletKey) {
          view.questionsNotAsked = body.analysis.questions_not_asked ?? [];
        }
        break;
      case "claim":
        if (body.outletKey === outletKey) view.claimCount += 1;
        break;
      default:
        break;
    }
  }
  return view;
}

/** Contradiction clues in which one outlet is on side A and the other on side B. */
export function contradictionsBetween(a: string, b: string, clues: Clue[]): Clue[] {
  return clues.filter((clue) => {
    if (clue.body.type !== "contradiction") return false;
    const { outletsA, outletsB } = clue.body;
    return (outletsA.includes(a) && outletsB.includes(b)) || (outletsA.includes(b) && outletsB.includes(a));
  });
}
