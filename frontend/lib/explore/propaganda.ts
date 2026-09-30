/**
 * Event-level signals per Herman & Chomsky filter, derived from the AI analysis of this event.
 *
 * Deliberately NO levels, scores or rankings: in line with the propaganda-model data licence we
 * show evidence ("aanwijzingen") that links to the clue it came from, never a verdict.
 * Structural relations (ownership, funding, advertisers, ...) come from the propaganda model itself.
 */

import { ArticleIndex } from "./input";
import { biasByOutlet } from "./bias";
import { FILTERS, frameLabel, type FilterId } from "./labels";
import { OWNERSHIP_TYPE_LABELS } from "./media-landscape";
import type { Clue, ExploreInput } from "./types";

export interface FilterSignal {
  text: string;
  clueIds: string[];
  outletKeys: string[];
}

export interface FilterEvidence {
  filter: FilterId;
  signals: FilterSignal[];
}

const OFFICIAL_SOURCES = /\b(overheid|minister|ministerie|kabinet|politie|justitie|officiële?|woordvoerder|rivm|instantie|gemeente|regering|autoriteit)/i;
const IDEOLOGY_FRAMES = new Set(["consensus", "inevitability", "authority_deference", "fear", "progress", "nostalgia"]);
const COUNTERPOWER_TONES = new Set(["kritisch"]);
const SENSATIONAL_TONES = new Set(["sensationeel", "alarmerend"]);

export function eventFilterSignals(
  input: ExploreInput,
  clues: Clue[],
  index: ArticleIndex = new ArticleIndex(input),
): FilterEvidence[] {
  const signals: Record<FilterId, FilterSignal[]> = {
    eigendom: [],
    advertentie: [],
    sourcing: [],
    flak: [],
    ideologie: [],
    tegenmacht: [],
  };
  const push = (filter: FilterId, text: string, clue: Clue | undefined, outletKeys: string[] = []) => {
    signals[filter].push({ text, clueIds: clue ? [clue.id] : [], outletKeys });
  };
  const name = (key: string | null | undefined) => (key ? (index.outlet(key)?.name ?? key) : "een bron");

  // Eigendom: ownership types of the outlets covering this event
  const ownershipClue = clues.find((clue) => clue.type === "ownership");
  const byType = new Map<string, string[]>();
  for (const outlet of input.outlets) {
    const type = outlet.profile?.ownershipType;
    if (!type || type === "unknown") continue;
    const list = byType.get(type) ?? [];
    list.push(outlet.key);
    byType.set(type, list);
  }
  for (const [type, keys] of Array.from(byType.entries())) {
    const label = OWNERSHIP_TYPE_LABELS[type as keyof typeof OWNERSHIP_TYPE_LABELS] ?? type;
    push("eigendom", `${label}: ${keys.map((key) => name(key)).join(", ")}`, ownershipClue, keys);
  }

  for (const clue of clues) {
    const body = clue.body;
    switch (body.type) {
      case "tone": {
        const tone = body.analysis.tone?.toLowerCase().trim() ?? "";
        if (SENSATIONAL_TONES.has(tone)) {
          push("advertentie", `${capitalize(tone)} toon bij ${name(body.outletKey)}`, clue, body.outletKey ? [body.outletKey] : []);
        }
        if (COUNTERPOWER_TONES.has(tone)) {
          push("tegenmacht", `Kritische toon bij ${name(body.outletKey)}`, clue, body.outletKey ? [body.outletKey] : []);
        }
        if (body.analysis.copy_paste_score?.toLowerCase().trim() === "hoog") {
          push("sourcing", `${name(body.outletKey)} leunt sterk op persberichten of andere media`, clue, body.outletKey ? [body.outletKey] : []);
        }
        if ((body.analysis.anonymous_source_count ?? 0) > 0) {
          push(
            "sourcing",
            `${body.analysis.anonymous_source_count} anonieme ${body.analysis.anonymous_source_count === 1 ? "bron" : "bronnen"} bij ${name(body.outletKey)}`,
            clue,
            body.outletKey ? [body.outletKey] : [],
          );
        }
        if (body.analysis.narrative_alignment?.trim()) {
          push("ideologie", `Past in een bestaand narratief (${name(body.outletKey)})`, clue, body.outletKey ? [body.outletKey] : []);
        }
        break;
      }
      case "voices": {
        if (body.sourcingPattern && OFFICIAL_SOURCES.test(body.sourcingPattern)) {
          push("sourcing", `${name(body.outletKey)} laat vooral officiële bronnen aan het woord`, clue, [body.outletKey]);
        }
        break;
      }
      case "authority": {
        push("sourcing", `${body.authority.authority} wordt als autoriteit opgevoerd`, clue, body.outletKey ? [body.outletKey] : []);
        if (body.authority.scope_creep?.trim()) {
          push("sourcing", `${body.authority.authority} adviseert mogelijk buiten het eigen mandaat`, clue);
        }
        break;
      }
      case "frame": {
        const type = body.frame.frame_type;
        const own = body.frame.attribution !== "geciteerd";
        if (type === "authority_deference" && own) {
          push("sourcing", `Frame "${frameLabel(type)}" in eigen woorden`, clue, clue.outletKeys);
        }
        if (IDEOLOGY_FRAMES.has(type) && own) {
          push("ideologie", `Frame "${frameLabel(type)}" in eigen woorden`, clue, clue.outletKeys);
        }
        break;
      }
      case "fallacy": {
        const type = body.fallacy.type.toLowerCase();
        if (type.includes("ad_hominem") || type.includes("stroman")) {
          push("flak", `Aanval op personen of verdraaide kritiek (${body.fallacy.type.replace(/_/g, " ")})`, clue, clue.outletKeys);
        }
        break;
      }
      case "consensus": {
        push("ideologie", "Alle bronnen brengen hetzelfde verhaal", clue, clue.outletKeys);
        break;
      }
      case "science": {
        if (!body.plurality.alternative_views_mentioned) {
          push("ideologie", "Alternatieve wetenschappelijke visies worden niet genoemd", clue);
        }
        break;
      }
      case "gap": {
        push("tegenmacht", `Ontbrekende stem: ${body.gap.perspective}`, clue);
        break;
      }
      default:
        break;
    }
  }

  // Flak: watchdog sources that criticise an outlet in this event (e.g. Een Blik op de NOS -> NOS)
  const present = new Set(input.outlets.map((outlet) => outlet.key));
  for (const outlet of input.outlets) {
    for (const target of outlet.profile?.watchdogOf ?? []) {
      if (present.has(target)) {
        push("flak", `${outlet.name} levert kritiek op ${name(target)}`, undefined, [outlet.key, target]);
      }
    }
  }

  // Flak: ad hominem in the journalist's own text (bias analysis)
  for (const entry of Array.from(biasByOutlet(input).values())) {
    const adHominem = entry.topTypes.find((item) => item.type === "Ad Hominem Bias");
    if (adHominem) {
      const clue = clues.find((candidate) => candidate.type === "bias" && candidate.outletKeys.includes(entry.outletKey));
      push("flak", `Op de man spelen in eigen tekst van ${name(entry.outletKey)} (${adHominem.count}×)`, clue, [entry.outletKey]);
    }
  }

  return FILTERS.map((filter) => ({ filter: filter.id, signals: signals[filter.id] }));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
