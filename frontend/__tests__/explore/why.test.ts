import { findPaths } from "@/lib/explore/pm-paths";
import { eventActorAliases, eventOutletSeeds, followedOutletIds, matchActorIds } from "@/lib/explore/pm-seeds";
import type { ExploreInput } from "@/lib/explore/types";
import { touchpoints, whyRoutesFor } from "@/lib/explore/why";
import type { PmEntity, PmMatch, PmRelation } from "@/lib/types";

// NU.nl and AD (both DPG), the NOS, the ANP as a hub, and NordVind that is in the news
const entities: PmEntity[] = [
  { id: 1, name: "NU.nl", type: "mediaorganisatie", degree: 3 },
  { id: 2, name: "AD", type: "mediaorganisatie", degree: 2 },
  { id: 3, name: "NOS", type: "omroep", degree: 1 },
  { id: 10, name: "DPG Media", type: "bedrijf", degree: 5 },
  { id: 11, name: "Sanoma", type: "bedrijf", degree: 2 },
  { id: 20, name: "ANP", type: "persbureau", degree: 60 },
  { id: 30, name: "NordVind", type: "bedrijf", degree: 3 },
];
const rel = (id: number, source_id: number, target_id: number, relation_type: string, extra: Partial<PmRelation> = {}): PmRelation => ({
  id,
  source_id,
  target_id,
  relation_type,
  source_count: 1,
  ...extra,
});
const relations: PmRelation[] = [
  rel(100, 10, 1, "eigendom", { certainty_label: "onderbouwd" }),
  rel(101, 10, 2, "eigendom"),
  rel(102, 30, 10, "adverteerder"),
  rel(103, 20, 1, "beinvloeding"),
  rel(104, 20, 2, "beinvloeding"),
  rel(105, 20, 3, "beinvloeding"),
  rel(106, 30, 20, "bron_van"),
];
const at = "2026-10-01";

describe("the parties of a news item in the model", () => {
  it("takes the Dutch outlets with a model id, once each", () => {
    const input = {
      outlets: [
        { key: "nos", isInternational: false, profile: { pmEntityId: 11 } },
        { key: "bbc", isInternational: true, profile: { pmEntityId: 999 } },
        { key: "nieuwrechts", isInternational: false, profile: {} },
        { key: "nos-2", isInternational: false, profile: { pmEntityId: 11 } },
      ],
    } as unknown as Pick<ExploreInput, "outlets">;
    expect(eventOutletSeeds(input)).toEqual([{ id: 11, outletKey: "nos" }]);
    const followed = followedOutletIds();
    expect(followed).toEqual(expect.arrayContaining([11, 7, 3, 9]));
    expect(new Set(followed).size).toBe(followed.length);
  });

  it("matches people only to persons, organisations never to persons, authorities to anything", () => {
    const input = {
      entities: [
        { kind: "person", aliases: ["jan-jansen"] },
        { kind: "org", aliases: ["nordvind"] },
        { kind: "place", aliases: ["dijkerhoven"] },
      ],
      insight: { authority_analysis: [{ authority: "Centraal Planbureau (CPB)" }] },
    } as unknown as Pick<ExploreInput, "entities" | "insight">;
    const actors = eventActorAliases(input);
    expect(actors.map((actor) => actor.kind)).toEqual(["person", "org", null]);
    expect(actors[2].aliases).toEqual(expect.arrayContaining(["cpb", "centraal-planbureau"]));

    const matches: PmMatch[] = [
      { alias: "jan-jansen", entity_id: 50, name: "Jan Jansen", type: "persoon" },
      { alias: "jan-jansen", entity_id: 51, name: "Jan Jansen BV", type: "bedrijf" },
      { alias: "nordvind", entity_id: 30, name: "NordVind", type: "bedrijf" },
      { alias: "nordvind", entity_id: 52, name: "Nordvind", type: "persoon" },
      { alias: "cpb", entity_id: 60, name: "CPB (Centraal Planbureau)", type: "overheidsinstelling" },
    ];
    expect(matchActorIds(actors, matches)).toEqual([50, 30, 60]);
    // Outlets are never a party of their own news
    expect(matchActorIds(actors, matches, new Set([30]))).toEqual([50, 60]);
  });
});

describe("Waarom zo?", () => {
  const paths = findPaths(entities, relations, [1, 2, 3], [30], { at, maxHops: 2, limit: 2 });

  it("puts what sets an outlet apart before what the other outlets of the news share", () => {
    // In a news item brought by NU.nl and the NOS, NU.nl's DPG route is its own; the ANP route is shared with the NOS
    const why = whyRoutesFor(paths, 1, [1, 3]);
    expect(why.map((item) => item.route.nodes)).toEqual([
      [1, 10, 30],
      [1, 20, 30],
    ]);
    expect(why.map((item) => item.sharedInNews)).toEqual([[], [3]]);
    expect(why.map((item) => item.ownership)).toEqual([true, false]);
    expect(whyRoutesFor(paths, 1, [1, 3], 1)).toHaveLength(1);
    expect(whyRoutesFor(null, 1, [1])).toEqual([]);
    expect(whyRoutesFor(paths, 999, [1])).toEqual([]);
  });

  it("lists every followed outlet with a link to the news, the ones that brought it first", () => {
    const list = touchpoints(paths, [3]);
    expect(list.map((item) => [item.outletId, item.covered, item.routes.length])).toEqual([
      [3, true, 1],
      [1, false, 2],
      [2, false, 2],
    ]);
    expect(touchpoints(undefined, [3])).toEqual([]);
  });
});
