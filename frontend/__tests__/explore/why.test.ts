import { findPaths } from "@/lib/explore/pm-paths";
import { eventActorAliases, eventOutletSeeds, followedOutletIds, matchActorIds } from "@/lib/explore/pm-seeds";
import type { ExploreInput } from "@/lib/explore/types";
import { labelSourceId, mechanismKey, pmRelationLabel, pmRelationReverseLabel, relationWords } from "@/lib/explore/labels";
import { behindParties, lineRelationIds, meaningfulRoute, readableRoute, touchpoints, typeLookup } from "@/lib/explore/why";
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
  rel(103, 20, 1, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing" }),
  rel(104, 20, 2, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing" }),
  rel(105, 20, 3, "beinvloeding", { mechanism: "Pakketjournalistiek", filter: "sourcing" }),
  rel(106, 30, 20, "bron_van", { filter: "sourcing" }),
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

// The news of the screenshot (2026-10-05): NOS, de Volkskrant and NU.nl, with RIVM and the PBL in it
const news: PmEntity[] = [
  { id: 11, name: "NOS", type: "omroep", degree: 9 },
  { id: 4, name: "de Volkskrant", type: "mediaorganisatie", degree: 9 },
  { id: 7, name: "NU.nl", type: "mediaorganisatie", degree: 9 },
  { id: 8, name: "RTL Nederland", type: "omroep", degree: 9 },
  { id: 1, name: "DPG Media", type: "mediaorganisatie", degree: 30 },
  { id: 82, name: "RIVM", type: "overheidsinstelling", degree: 12 },
  { id: 865, name: "Planbureau voor de Leefomgeving (PBL)", type: "overheidsinstelling", degree: 4 },
  { id: 900, name: "Marko Hekkert", type: "persoon", degree: 2 },
  { id: 901, name: "Nieuwsuur", type: "mediaorganisatie", degree: 3 },
  { id: 53, name: "VVD", type: "partij", degree: 40 },
  { id: 954, name: "Eelco Heinen", type: "persoon", degree: 2 },
];
const source = (id: number, from: number, to: number, mechanism: string, extra: Partial<PmRelation> = {}) =>
  rel(id, from, to, "beinvloeding", { mechanism, filter: "sourcing", ...extra });
const newsRelations: PmRelation[] = [
  source(143, 82, 11, "Bron afhankelijkheid", { certainty_label: "onzeker" }),
  source(220, 82, 4, "Bron afhankelijkheid"),
  source(144, 82, 8, "Bron afhankelijkheid"),
  source(432, 4, 8, "Intermedia-agendering"),
  source(1564, 865, 11, "Expert framing"),
  rel(1565, 900, 865, "personeel", { mechanism: "Denktank levert expert", filter: "sourcing" }),
  source(1803, 900, 11, "Expert legitimatie"),
  rel(1011, 11, 901, "mediaplatform", { mechanism: "Omroepsignatuur", filter: "ideologie" }),
  source(1579, 82, 901, "Expert framing"),
  source(145, 82, 1, "Bron afhankelijkheid"),
  rel(249, 1, 7, "beinvloeding", { mechanism: "Zelfcensuur", filter: "flak" }),
  rel(2282, 53, 954, "lidmaatschap", { mechanism: "Partijbinding", filter: "ideologie" }),
];
const name = (id: number) => news.find((entity) => entity.id === id)?.name;

describe("Wie zit erachter?", () => {
  const newsPaths = findPaths(news, newsRelations, [11, 4, 7], [82, 865], { at, maxHops: 2, limit: 3 });
  const byId = new Map(newsRelations.map((relation) => [relation.id, relation]));
  const route = (nodes: number[]) => newsPaths.routes.find((item) => item.nodes.join() === nodes.join());

  it("drops routes along which no influence reaches the outlet", () => {
    // De Volkskrant sets the agenda of RTL, RIVM is a source of RTL: nothing about the Volkskrant
    expect(meaningfulRoute(route([4, 8, 82])!, byId)).toBe(false);
    // Two kinds of influence on DPG Media without a tie of belonging to NU.nl
    expect(meaningfulRoute(route([7, 1, 82])!, byId)).toBe(false);
    // A programme of the NOS, a researcher of the PBL: stations that belong to one end
    expect(meaningfulRoute(route([11, 901, 82])!, byId)).toBe(true);
    expect(meaningfulRoute(route([11, 900, 865])!, byId)).toBe(true);
    expect(meaningfulRoute(route([11, 82])!, byId)).toBe(true);
    expect(meaningfulRoute({ nodes: [11, 82], relations: [999] }, byId)).toBe(false);
  });

  it("groups per party what reaches the outlets, read from the party", () => {
    const parties = behindParties(newsPaths, [11, 4, 7]);
    expect(parties.map((party) => [name(party.partyId), party.outletIds.map(name)])).toEqual([
      ["RIVM", ["NOS", "de Volkskrant"]],
      ["Planbureau voor de Leefomgeving (PBL)", ["NOS"]],
    ]);
    const words = parties.map((party) =>
      party.lines.map((line) =>
        [...line.lead, line.last[0]].map((step) => (step.forward ? pmRelationLabel(step.relation.relation_type, step.relation.mechanism) : pmRelationReverseLabel(step.relation.relation_type, step.relation.mechanism))).join(" › ") +
        ` › ${line.last.map((step) => name(step.to)).join(" + ")}`,
      ),
    );
    expect(words).toEqual([
      ["is vaste bron voor › NOS + de Volkskrant", "levert experts en analyses aan › verschijnt bij › NOS"],
      ["levert experts en analyses aan › NOS", "heeft als medewerker › treedt op als deskundige bij › NOS"],
    ]);
    // The step that carries the influence explains more than the tie of belonging
    expect(parties[1].lines[1].explain).toEqual([1803, 1565]);
    expect(parties[0].lines[0].explain).toEqual([143, 220]);
    expect(behindParties(null, [11])).toEqual([]);
    expect(behindParties(newsPaths, [])).toEqual([]);
  });

  it("splits and orders the lines by how well the model supports them", () => {
    // RIVM → NOS rests on a source, RIVM → de Volkskrant is disputed, RIVM → Nieuwsuur has nothing
    const ranks: Record<number, number> = { 143: 1, 220: 3, 1579: 5, 1564: 1, 1803: 1 };
    const parties = behindParties(newsPaths, [11, 4, 7], (id) => ranks[id]);
    expect(parties.map((party) => [name(party.partyId), party.lines.map((line) => [line.rank, line.last.map((step) => name(step.to)).join(" + ")])])).toEqual([
      [
        "RIVM",
        [
          [1, "NOS"],
          [3, "de Volkskrant"],
          [5, "NOS"],
        ],
      ],
      [
        "Planbureau voor de Leefomgeving (PBL)",
        [
          [1, "NOS"],
          [1, "NOS"],
        ],
      ],
    ]);
    // the expert line counts its influence (Hekkert at the NOS), not the tie of belonging
    expect(parties[1].lines[1].lead.map((step) => step.relation.id)).toEqual([1565]);
    // a party whose links are all weak comes after a better supported one
    const weakRivm = behindParties(newsPaths, [11, 4, 7], (id) => (id === 143 || id === 220 || id === 1579 ? 4 : ranks[id]));
    expect(weakRivm.map((party) => name(party.partyId))).toEqual(["Planbureau voor de Leefomgeving (PBL)", "RIVM"]);
    // unknown support (no arguments looked up) keeps lines together, as before
    expect(behindParties(newsPaths, [11, 4, 7], () => undefined)[0].lines[0].last).toHaveLength(2);
    expect(lineRelationIds(parties)).toEqual([143, 220, 1579, 1011, 1564, 1803, 1565]);
  });

  it("reads a route with the influence, arrows where it has a direction", () => {
    const typeOf = typeLookup(news);
    const direct = readableRoute(route([11, 82])!, byId, typeOf);
    expect(direct.map((step) => [name(step.from), step.flow, name(step.to)])).toEqual([["RIVM", "down", "NOS"]]);
    const expert = readableRoute(route([11, 900, 865])!, byId, typeOf);
    expect(expert.map((step) => [name(step.from), step.flow, name(step.to)])).toEqual([
      ["Planbureau voor de Leefomgeving (PBL)", "both", "Marko Hekkert"],
      ["Marko Hekkert", "down", "NOS"],
    ]);
    expect(readableRoute({ nodes: [11, 82], relations: [999] }, byId, typeOf)).toEqual([]);
  });
});

describe("reading relations", () => {
  it("says what an influence is by its mechanism", () => {
    expect(mechanismKey("Intermedia-agendering")).toBe("intermedia_agendering");
    expect(mechanismKey("Commerciële afhankelijkheid")).toBe("commerciele_afhankelijkheid");
    expect(pmRelationLabel("beinvloeding", "Bron afhankelijkheid")).toBe("is vaste bron voor");
    expect(pmRelationReverseLabel("beinvloeding", "Bron afhankelijkheid")).toBe("leunt als bron op");
    expect(pmRelationLabel("beinvloeding", "Intermedia-agendering")).toBe("zet de agenda van");
    expect(pmRelationLabel("beinvloeding", "Iets nieuws")).toBe("beïnvloedt via iets nieuws");
    expect(pmRelationLabel("beinvloeding")).toBe("beïnvloedt");
    expect(pmRelationLabel("eigendom", "Eigendomsconcentratie")).toBe("is eigenaar van");
  });

  it("reads memberships and jobs from the person, however the model stores them", () => {
    const typeOf = typeLookup(news);
    const party = byIdOf(2282);
    expect(labelSourceId(party, typeOf)).toBe(954);
    expect(relationWords(party, 954, typeOf)).toBe("is lid van");
    expect(relationWords(party, 53, typeOf)).toBe("heeft als lid");
    const job = rel(1, 900, 865, "personeel");
    expect(relationWords(job, 900, typeOf)).toBe("werkt voor");
    const network = rel(2, 50, 51, "lidmaatschap");
    expect(labelSourceId(network, (id) => (id === 50 ? "elite_netwerk" : "bedrijf"))).toBe(51);
    // Not an affiliation: always from the source
    expect(labelSourceId(byIdOf(143), typeOf)).toBe(82);
  });
});

function byIdOf(id: number): PmRelation {
  return newsRelations.find((relation) => relation.id === id) as PmRelation;
}
